"""Regression tests for the 2026-11-18 audit's P0 fixes
(docs/audit/2026-11-18-product-audit.md): REL-01, BIZ-01 and SEC-03."""
import io
import json
import os
import threading
import time

import pytest
from PIL import Image
from sqlalchemy import create_engine, text

from .conftest import _sync_url, register
from .test_publishing import approved_post, make_account, publish_now

pytestmark = pytest.mark.integration


# ── REL-01: the dispatcher must never orphan a job ─────────────────────
@pytest.fixture()
def captured_dispatch(monkeypatch, db_exec):
    """Replace the broker send. At the moment a message would go out, a worker
    could already be running it — so the job row must be committed with its
    task id and NOT be locked by the dispatcher any more."""
    from app.workers.tasks import publish

    sent: list[dict] = []

    def fake_apply_async(kwargs, task_id=None, **_):
        row = db_exec(
            "SELECT celery_task_id FROM publish_jobs WHERE id = :j FOR UPDATE NOWAIT", j=kwargs["job_id"]
        ).first()  # raises if the dispatcher still holds the row lock
        sent.append({"job_id": kwargs["job_id"], "task_id": task_id, "committed_task_id": row[0]})

    def start() -> list[dict]:
        """Call after setting up jobs (the API's own publish-now send is real)."""
        monkeypatch.setattr(publish.publish_post_task, "apply_async", fake_apply_async)
        return sent

    return start


def _due_job(api):
    owner = register(api)
    acct = make_account(api, owner)
    post_id = approved_post(api, owner)
    return publish_now(api, owner, post_id, [acct["id"]])[acct["id"]]


def test_dispatcher_commits_the_task_id_before_sending(api, db_exec, captured_dispatch):
    from app.workers.tasks.publish import dispatch_due_jobs

    job_id = _due_job(api)
    db_exec("UPDATE publish_jobs SET celery_task_id = NULL WHERE id = :j", j=job_id)  # not yet dispatched
    sent = captured_dispatch()

    dispatch_due_jobs()

    mine = [m for m in sent if m["job_id"] == job_id]
    assert len(mine) == 1
    assert mine[0]["task_id"] and mine[0]["committed_task_id"] == mine[0]["task_id"]


def test_lost_message_is_dispatched_again_but_pending_retry_is_not(api, db_exec, captured_dispatch):
    from app.workers.tasks.publish import dispatch_due_jobs

    lost = _due_job(api)
    db_exec("UPDATE publish_jobs SET celery_task_id = 'lost-message', scheduled_for = now() - interval '1 hour' "
            "WHERE id = :j", j=lost)
    waiting = _due_job(api)  # a retry waiting for its backoff: due in the future
    db_exec("UPDATE publish_jobs SET celery_task_id = 'retry-pending', scheduled_for = now() + interval '5 minutes' "
            "WHERE id = :j", j=waiting)
    sent = captured_dispatch()

    dispatch_due_jobs()

    resent = [m for m in sent if m["job_id"] == lost]
    assert len(resent) == 1 and resent[0]["task_id"] != "lost-message"
    assert not [m for m in sent if m["job_id"] == waiting]
    assert db_exec("SELECT celery_task_id FROM publish_jobs WHERE id = :j", j=waiting).scalar() == "retry-pending"


# ── BIZ-01: two "Post now" requests must not both create jobs ──────────
def test_publish_now_waits_for_and_respects_a_concurrent_change(api, db_exec):
    """Simulates the first of two clicks holding the post: the second request
    must wait for it and then see the post is no longer approved — before the
    fix it read the old 'approved' row and created a second set of jobs."""
    owner = register(api)
    acct = make_account(api, owner)
    post_id = approved_post(api, owner)

    engine = create_engine(_sync_url())
    result: dict = {}
    worker = threading.Thread(target=lambda: result.update(r=api.post(
        f"/api/v1/posts/{post_id}/publish-now", json={"social_account_ids": [acct["id"]]},
        headers=owner.headers)))
    try:
        with engine.connect() as conn:
            tx = conn.begin()
            conn.execute(text("SELECT id FROM posts WHERE id = :p FOR UPDATE"), {"p": post_id})
            worker.start()
            time.sleep(1.0)
            waited = worker.is_alive()
            # The "first click" wins: the post is scheduled before the lock is released.
            conn.execute(text("UPDATE posts SET status = 'scheduled', scheduled_at = now() WHERE id = :p"),
                         {"p": post_id})
            tx.commit()
    finally:
        if worker.is_alive() or worker.ident is not None:
            worker.join(20)
        engine.dispose()

    assert waited, "the request did not wait for the post's row lock"

    assert result["r"].status_code == 400, result["r"].text
    assert db_exec("SELECT count(*) FROM publish_jobs WHERE post_id = :p", p=post_id).scalar() == 0


# ── SEC-03: brand guidelines can't steer storage deletes ───────────────
def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8)).save(out, format="PNG")
    return out.getvalue()


def _logo(api, actor, brand_id):
    r = api.post(f"/api/v1/brands/{brand_id}/logo", files={"file": ("logo.png", _png())}, headers=actor.headers)
    assert r.status_code == 200, r.text
    return api.get(f"/api/v1/brands/{brand_id}", headers=actor.headers).json()["brand_guidelines"]["_logo_storage_key"]


def test_brand_guidelines_cannot_point_logo_delete_at_another_file(api, db_exec):
    from app.services.storage import LocalStorage

    storage = LocalStorage()
    victim = f"media/audit-victim-{os.urandom(4).hex()}.png"
    storage.save(victim, b"someone else's photo")
    try:
        owner = register(api)
        brand = api.post(f"/api/v1/workspaces/{owner.workspace_id}/brands", json={"name": "Logo brand"},
                         headers=owner.headers).json()
        first_key = _logo(api, owner, brand["id"])
        assert first_key.startswith(f"brands/{brand['id']}/")

        # A client-supplied key is dropped and the real one is kept.
        r = api.patch(f"/api/v1/brands/{brand['id']}",
                      json={"brand_guidelines": {"palette": ["#123456"], "_logo_storage_key": victim}},
                      headers=owner.headers)
        assert r.status_code == 200, r.text
        assert r.json()["brand_guidelines"] == {"palette": ["#123456"], "_logo_storage_key": first_key}

        # Even a foreign key already in the database is never deleted.
        db_exec("UPDATE brands SET brand_guidelines = CAST(:g AS jsonb) WHERE id = :b",
                g=json.dumps({"_logo_storage_key": victim}), b=brand["id"])
        _logo(api, owner, brand["id"])
        assert os.path.isfile(storage._path(victim))
    finally:
        storage.delete(victim)
