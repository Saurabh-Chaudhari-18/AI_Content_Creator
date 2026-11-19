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
