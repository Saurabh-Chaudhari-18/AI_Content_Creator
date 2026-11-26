"""Never fail silently: a post that fails or only partly publishes tells its
author and the managers, in the bell and by email (migration 0011)."""
import pytest

from app.services import email as mailer

from .conftest import run_job
from .test_client_approvals import API, draft, notes, submit, team
from .test_email import _send, _to
from .test_publishing import make_account, publish_now, post_status


@pytest.fixture(autouse=True)
def empty_outbox(database, db_exec):
    db_exec("UPDATE email_outbox SET status = 'skipped', body_encrypted = NULL WHERE status = 'queued'")
    mailer.SENT.clear()
    yield
    mailer.SENT.clear()


def _approved(api, t):
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id)
    assert api.post(f"{API}/posts/{post_id}/approve", headers=t.priya.headers).status_code == 200
    return post_id


def _failed_notes(api, actor, ws, post_id):
    return [n for n in notes(api, actor, ws) if n["post_id"] == post_id and n["type"] == "publish_failed"]


def test_failed_post_tells_author_and_managers_once(api):
    t = team(api)
    acct = make_account(api, t.owner, "facebook", name="Sunrise Page")
    post_id = _approved(api, t)
    jobs = publish_now(api, t.owner, post_id, [acct["id"]])
    assert api.delete(f"{API}/social/accounts/{acct['id']}", headers=t.owner.headers).status_code == 200
    assert run_job(jobs[acct["id"]])["status"] == "failed"
    assert post_status(api, t.owner, post_id) == "failed"

    for person in (t.writer, t.owner, t.priya, t.amit):
        [note] = _failed_notes(api, person, t.ws, post_id)
        assert "didn't go out on Facebook (Sunrise Page)" in note["message"] and "retry" in note["message"]

    _send()
    for person in (t.writer, t.owner, t.priya, t.amit):
        [mail] = [m for m in _to(person.email) if m.kind == "publish_failed"]
        assert f"/posts/{post_id}" in mail.text

    # Settling the same outcome again (e.g. the stale-job sweep) doesn't repeat it.
    from app.db.session import worker_session
    from app.workers.tasks.publish import _finalize_post

    with worker_session() as db:
        _finalize_post(db, post_id)
    assert len(_failed_notes(api, t.writer, t.ws, post_id)) == 1


def test_partly_published_and_unknown_outcome(api, db_exec):
    t = team(api)
    good = make_account(api, t.owner, "facebook", name="Main Page")
    gone = make_account(api, t.owner, "linkedin", name="Company Page")
    post_id = _approved(api, t)
    jobs = publish_now(api, t.owner, post_id, [good["id"], gone["id"]])
    api.delete(f"{API}/social/accounts/{gone['id']}", headers=t.owner.headers)
    run_job(jobs[good["id"]])
    run_job(jobs[gone["id"]])
    assert post_status(api, t.owner, post_id) == "partially_published"
    [note] = _failed_notes(api, t.writer, t.ws, post_id)
    assert "partly published" in note["message"] and "LinkedIn (Company Page)" in note["message"]
    assert "Main Page" not in note["message"]

    # An outcome nobody could confirm says so, and asks for a check first.
    other = _approved(api, t)
    jobs = publish_now(api, t.owner, other, [good["id"]])
    db_exec("UPDATE publish_jobs SET status = 'processing', started_at = now() - interval '2 hours' WHERE id = :j",
            j=jobs[good["id"]])
    from app.workers.tasks.cleanup import cleanup_stale_jobs

    cleanup_stale_jobs.apply().get()
    assert post_status(api, t.owner, other) == "failed"
    [note] = _failed_notes(api, t.priya, t.ws, other)
    assert "may or may not have gone out" in note["message"] and "check the page before retrying" in note["message"]


def test_published_post_sends_no_notice(api):
    t = team(api)
    acct = make_account(api, t.owner, "facebook")
    post_id = _approved(api, t)
    jobs = publish_now(api, t.owner, post_id, [acct["id"]])
    run_job(jobs[acct["id"]])
    assert post_status(api, t.owner, post_id) == "published"
    assert _failed_notes(api, t.writer, t.ws, post_id) == []
