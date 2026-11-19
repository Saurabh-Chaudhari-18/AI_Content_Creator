"""Regression tests for the audit's P1 fixes (docs/audit/2026-11-18-product-audit.md)."""
import threading
import uuid

import pytest

pytestmark = pytest.mark.integration


def _session_cookies(api) -> tuple[str, str]:
    """Register a fresh user; return its (refresh, csrf) cookie values."""
    email = f"{uuid.uuid4().hex[:10]}@example.com"
    r = api.post("/api/v1/auth/register", json={"email": email, "password": "password123", "full_name": "Tabs"})
    assert r.status_code == 201, r.text
    return r.cookies["refresh_token"], r.cookies["csrf_token"]


def _refresh(api, refresh: str, csrf: str):
    # An explicit Cookie header: the shared client's own cookie jar is not used.
    return api.post(
        "/api/v1/auth/refresh",
        headers={"Cookie": f"refresh_token={refresh}; csrf_token={csrf}", "X-CSRF-Token": csrf},
    )


# ── SEC-08 / FE-02: two tabs refreshing with the same cookie ───────────
def test_a_refresh_cookie_works_once_and_a_reuse_does_not_delete_cookies(api):
    refresh, csrf = _session_cookies(api)

    first = _refresh(api, refresh, csrf)
    assert first.status_code == 200, first.text
    assert first.cookies.get("refresh_token") not in (None, "", refresh)

    again = _refresh(api, refresh, csrf)
    assert again.status_code == 401
    # The other tab's NEW cookie must survive: no Set-Cookie that clears it.
    assert "set-cookie" not in again.headers


def test_concurrent_refreshes_with_one_cookie_mint_exactly_one_session(api, db_exec):
    refresh, csrf = _session_cookies(api)
    results: list[int] = []

    def go():
        results.append(_refresh(api, refresh, csrf).status_code)

    threads = [threading.Thread(target=go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert sorted(results) == [200, 401, 401, 401]


# ── SEC-13: staff observe workspaces, they never join one ──────────────
def test_platform_staff_cannot_be_added_to_a_customer_workspace(api, db_exec):
    from .conftest import register

    staff = register(api, "Staff")
    db_exec("UPDATE users SET platform_role = 'super_admin' WHERE id = :id", id=staff.user_id)
    customer = register(api, "Customer")
    why = {"reason": "integration test"}

    # Staff adding their own login through the admin panel
    r = api.post(f"/api/v1/admin/workspaces/{customer.workspace_id}/members",
                 json={"email": staff.email, "role": "admin", **why}, headers=staff.headers)
    assert r.status_code == 400 and "staff" in r.json()["detail"]
    # ...or a customer adding a staff login themselves
    r = api.post(f"/api/v1/workspaces/{customer.workspace_id}/members",
                 json={"email": staff.email, "role": "member"}, headers=customer.headers)
    assert r.status_code == 400 and "staff" in r.json()["detail"]

    members = db_exec("SELECT count(*) FROM workspace_members WHERE workspace_id = :w AND user_id = :u",
                      w=customer.workspace_id, u=staff.user_id).scalar()
    assert members == 0


# ── BIZ-04 / DB-18: a deleted post takes its files with it ─────────────
def test_deleting_a_post_deletes_its_stored_files(api, db_exec):
    import os

    from app.services.storage import LOCAL_UPLOAD_DIR

    from .conftest import register
    from .test_plan_features import new_brand, new_post, png, upload

    owner = register(api)
    brand_id = new_brand(api, owner).json()["id"]
    post_id = new_post(api, owner, brand_id).json()["id"]
    r = upload(api, owner, post_id, "photo.png", png())
    assert r.status_code == 201, r.text
    key = db_exec("SELECT storage_key FROM post_media WHERE post_id = :p", p=post_id).scalar()
    path = os.path.join(LOCAL_UPLOAD_DIR, key)
    assert os.path.isfile(path)

    assert api.delete(f"/api/v1/posts/{post_id}", headers=owner.headers).status_code == 200
    assert not os.path.isfile(path)


# ── BIZ-01 backstop: the database refuses a second live job ─────────────
def test_database_refuses_a_second_live_job_for_the_same_post_and_account(api, db_exec):
    import sqlalchemy

    from .conftest import register
    from .test_publishing import approved_post, make_account, publish_now

    owner = register(api)
    acct = make_account(api, owner)
    post_id = approved_post(api, owner)
    publish_now(api, owner, post_id, [acct["id"]])

    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_exec("INSERT INTO publish_jobs (id, post_id, social_account_id, status, attempt_number) "
                "VALUES (gen_random_uuid(), :p, :a, 'queued', 0)", p=post_id, a=acct["id"])
    # A finished job does not block a new one (a retry or a later re-post).
    db_exec("UPDATE publish_jobs SET status = 'completed' WHERE post_id = :p", p=post_id)
    db_exec("INSERT INTO publish_jobs (id, post_id, social_account_id, status, attempt_number) "
            "VALUES (gen_random_uuid(), :p, :a, 'queued', 0)", p=post_id, a=acct["id"])


# ── PERF-04: the calendar is always a bounded window ───────────────────
def test_calendar_refuses_an_unbounded_window(api):
    from .conftest import register

    owner = register(api)
    url = f"/api/v1/workspaces/{owner.workspace_id}/calendar"
    assert api.get(url, headers=owner.headers).status_code == 200  # defaults to 6 weeks
    too_long = {"start_date": "2026-01-01T00:00:00Z", "end_date": "2026-12-31T00:00:00Z"}
    assert api.get(url, params=too_long, headers=owner.headers).status_code == 400
    mixed = {"start_date": "2026-01-01T00:00:00", "end_date": "2026-02-01T00:00:00Z"}
    assert api.get(url, params=mixed, headers=owner.headers).status_code == 200
