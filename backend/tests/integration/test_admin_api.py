"""The admin API (/api/v1/admin): who can reach it, what it can change, and
that every change reaches the customer on their next request and leaves an
audit record."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.features import FEATURES

from .conftest import Actor, register, run_job
from .test_plan_features import assert_blocked, features_of, new_brand, new_post, set_plan
from .test_publishing import approved_post, make_account, post_status, publish_now

pytestmark = pytest.mark.integration

ADMIN = "/api/v1/admin"
WHY = {"reason": "integration test"}


@pytest.fixture()
def admin(api, db_exec) -> Actor:
    actor = register(api, "Platform Owner")
    db_exec("UPDATE users SET platform_role = 'super_admin' WHERE id = :id", id=actor.user_id)
    return actor


def audit_rows(api, admin, **filters) -> list[dict]:
    r = api.get(f"{ADMIN}/audit", params=filters, headers=admin.headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def login(api, email, password):
    return api.post("/api/v1/auth/login", json={"email": email, "password": password})


def token_of(link: str) -> str:
    return link.split("token=")[1]


def new_email() -> str:
    return f"{uuid.uuid4().hex[:10]}@example.com"


# ── Who can reach it ───────────────────────────────────────────────────
def test_the_admin_api_does_not_exist_for_customers(api):
    customer = register(api)
    assert api.get(f"{ADMIN}/overview").status_code == 401
    assert api.get(f"{ADMIN}/overview", headers=customer.headers).status_code == 404
    r = api.post(f"{ADMIN}/workspaces/{customer.workspace_id}/suspend", json=WHY, headers=customer.headers)
    assert r.status_code == 404
    r = api.put(f"{ADMIN}/users/{customer.user_id}/platform-role", headers=customer.headers,
                json={"platform_role": "super_admin", **WHY})
    assert r.status_code == 404  # nobody can promote themselves


def test_auth_me_says_who_is_staff(api, admin):
    """The web app sends staff to the console after sign-in, so /auth/me carries the role."""
    customer = register(api)
    assert api.get("/api/v1/auth/me", headers=customer.headers).json()["platform_role"] is None
    assert api.get("/api/v1/auth/me", headers=admin.headers).json()["platform_role"] == "super_admin"


def test_losing_the_role_takes_effect_on_the_next_request(api, db_exec, admin):
    assert api.get(f"{ADMIN}/overview", headers=admin.headers).status_code == 200
    db_exec("UPDATE users SET platform_role = NULL WHERE id = :id", id=admin.user_id)
    assert api.get(f"{ADMIN}/overview", headers=admin.headers).status_code == 404


def test_overview_runs_as_the_restricted_database_role(api, admin):
    body = api.get(f"{ADMIN}/overview", headers=admin.headers).json()
    assert body["database_role"] == "omnipost_admin"
    assert body["workspaces_total"] >= 1 and body["users_active"] >= 1
    assert body["workspaces_by_plan"]["founding"] >= 1


def test_first_super_admin_comes_from_the_command_line(api):
    from app.cli import main

    user = register(api)
    assert api.get(f"{ADMIN}/overview", headers=user.headers).status_code == 404
    assert main(["grant-super-admin", user.email.upper()]) == 0
    assert api.get(f"{ADMIN}/overview", headers=user.headers).status_code == 200
    assert main(["grant-super-admin", "nobody@example.com"]) == 1


# ── Workspaces ─────────────────────────────────────────────────────────
def test_find_a_workspace_and_see_its_details(api, admin):
    customer = register(api, "Acme Bakery")
    new_brand(api, customer)

    found = api.get(f"{ADMIN}/workspaces", params={"search": customer.email}, headers=admin.headers).json()
    assert found["total"] == 1
    assert found["items"][0]["id"] == customer.workspace_id
    assert found["items"][0]["owner_email"] == customer.email

    detail = api.get(f"{ADMIN}/workspaces/{customer.workspace_id}", headers=admin.headers).json()
    assert (detail["plan_key"], detail["status"], detail["member_count"], detail["brand_count"]) == \
        ("founding", "active", 1, 1)
    assert api.get(f"{ADMIN}/workspaces/{uuid.uuid4()}", headers=admin.headers).status_code == 404


def test_plan_change_reaches_the_customer_at_once_and_is_audited(api, admin):
    customer = register(api)
    url = f"{ADMIN}/workspaces/{customer.workspace_id}"

    assert api.patch(url, json={"plan_key": "free"}, headers=admin.headers).status_code == 422  # no reason
    assert api.patch(url, json={"plan_key": "nope", **WHY}, headers=admin.headers).status_code == 400
    r = api.patch(url, json={"plan_key": "free", "reason": "trial ended"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["plan_key"] == "free"

    assert features_of(api, customer)["_plan"] == "free"
    new_brand(api, customer)
    assert_blocked(new_brand(api, customer), "limit_reached", "max_brands")

    change = audit_rows(api, admin, workspace_id=customer.workspace_id, action="PLAN_CHANGE")[0]
    assert change["reason"] == "trial ended"
    assert change["actor_platform_role"] == "super_admin" and change["user_email"] == admin.email
    assert change["changes"] == {"before": {"plan": "founding"}, "after": {"plan": "free"}}


def test_feature_override_for_one_customer(api, admin, db_exec):
    customer = register(api)
    set_plan(db_exec, customer, "free")
    url = f"{ADMIN}/workspaces/{customer.workspace_id}/features"
    trial_end = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()

    r = api.put(f"{url}/linkedin_publishing", headers=admin.headers,
                json={"enabled": True, "expires_at": trial_end, "reason": "14 day trial"})
    assert r.status_code == 200, r.text
    linkedin = {f["key"]: f for f in r.json()["features"]}["linkedin_publishing"]
    assert (linkedin["enabled"], linkedin["source"], linkedin["plan_enabled"]) == (True, "override", False)
    assert linkedin["override"]["reason"] == "14 day trial" and linkedin["override"]["expired"] is False
    assert features_of(api, customer)["linkedin_publishing"]["enabled"] is True

    r = api.put(f"{url}/max_brands", json={"enabled": True, "limit": 3, **WHY}, headers=admin.headers)
    assert r.status_code == 200
    assert features_of(api, customer)["max_brands"]["limit"] == 3

    # Refused: a limit on an on/off feature, a feature that does not exist, an end date in the past.
    assert api.put(f"{url}/scheduling", json={"enabled": True, "limit": 5, **WHY},
                   headers=admin.headers).status_code == 400
    assert api.put(f"{url}/teleportation", json={"enabled": True, **WHY}, headers=admin.headers).status_code == 404
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert api.put(f"{url}/scheduling", json={"enabled": False, "expires_at": past, **WHY},
                   headers=admin.headers).status_code == 400

    # Back to the plan default.
    assert api.delete(f"{url}/linkedin_publishing", headers=admin.headers).status_code == 422  # no reason
    r = api.delete(f"{url}/linkedin_publishing", params=WHY, headers=admin.headers)
    assert r.status_code == 200
    assert features_of(api, customer)["linkedin_publishing"]["enabled"] is False
    assert api.delete(f"{url}/linkedin_publishing", params=WHY, headers=admin.headers).status_code == 404

    changes = audit_rows(api, admin, workspace_id=customer.workspace_id, action="FEATURE_CHANGE")
    assert len(changes) == 3


def test_suspended_workspace_is_read_only_and_publishes_nothing(api, admin):
    customer = register(api)
    acct = make_account(api, customer)
    queued_post = approved_post(api, customer)
    jobs = publish_now(api, customer, queued_post, [acct["id"]])
    url = f"{ADMIN}/workspaces/{customer.workspace_id}"

    assert api.post(f"{url}/suspend", json={}, headers=admin.headers).status_code == 422
    r = api.post(f"{url}/suspend", json={"reason": "invoice unpaid"}, headers=admin.headers)
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["suspended_reason"]) == ("suspended", "invoice unpaid")
    assert api.post(f"{url}/suspend", json=WHY, headers=admin.headers).status_code == 400

    # The customer can still sign in and look...
    assert api.get(f"/api/v1/workspaces/{customer.workspace_id}/posts", headers=customer.headers).status_code == 200
    assert api.get(f"/api/v1/posts/{queued_post}", headers=customer.headers).status_code == 200
    # ...but cannot change anything.
    for response in (
        new_brand(api, customer),
        api.patch(f"/api/v1/posts/{queued_post}", json={"caption": "edit"}, headers=customer.headers),
        api.delete(f"/api/v1/social/accounts/{acct['id']}", headers=customer.headers),
    ):
        assert response.status_code == 403, response.text
        assert response.headers["x-plan-restriction"] == "workspace_suspended"
    # ...and what was queued does not go out.
    assert run_job(jobs[acct["id"]]) == {"status": "failed", "reason": "workspace_suspended"}
    assert post_status(api, customer, queued_post) == "failed"

    r = api.post(f"{url}/reactivate", json=WHY, headers=admin.headers)
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["suspended_reason"] is None
    assert new_brand(api, customer).status_code == 201
    assert api.post(f"/api/v1/posts/{queued_post}/retry", json={}, headers=customer.headers).status_code == 200

    actions = [row["action"] for row in audit_rows(api, admin, workspace_id=customer.workspace_id, staff_only=True)]
    assert actions[:2] == ["REACTIVATE", "SUSPEND"]


def test_create_a_workspace_for_an_existing_login(api, admin):
    customer = register(api)
    r = api.post(f"{ADMIN}/workspaces", headers=admin.headers,
                 json={"name": "Second Shop", "owner_email": customer.email, "plan_key": "pro", **WHY})
    assert r.status_code == 201, r.text
    assert (r.json()["plan_key"], r.json()["owner_email"], r.json()["member_count"]) == ("pro", customer.email, 1)

    mine = api.get("/api/v1/workspaces", headers=customer.headers).json()
    assert {w["name"] for w in mine} >= {"Second Shop"}

    r = api.post(f"{ADMIN}/workspaces", headers=admin.headers,
                 json={"name": "X", "owner_email": new_email(), **WHY})
    assert r.status_code == 400  # no such login


# ── Logins ─────────────────────────────────────────────────────────────
def test_create_a_login_with_its_own_workspace(api, admin):
    email = new_email()
    r = api.post(f"{ADMIN}/users", headers=admin.headers,
                 json={"email": email.upper(), "full_name": "New Customer",
                       "new_workspace_name": "New Co", "reason": "onboarded by phone"})
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["email"] == email and created["workspace_id"]
    assert "/set-password?token=" in created["setup_link"]

    # No password exists until the customer chooses one.
    assert login(api, email, "password123").status_code == 401
    assert login(api, email, "!").status_code == 401

    token = token_of(created["setup_link"])
    assert api.post("/api/v1/auth/set-password", json={"token": token, "password": "short"}).status_code == 422
    r = api.post("/api/v1/auth/set-password", json={"token": token, "password": "chosen-by-customer"})
    assert r.status_code == 200, r.text
    # One use only.
    assert api.post("/api/v1/auth/set-password",
                    json={"token": token, "password": "someone-else-1"}).status_code == 400

    session = login(api, email, "chosen-by-customer")
    assert session.status_code == 200
    headers = {"Authorization": f"Bearer {session.json()['access_token']}"}
    workspaces = api.get("/api/v1/workspaces", headers=headers).json()
    assert [w["name"] for w in workspaces] == ["New Co"]
    assert new_brand(api, Actor(headers, created["user_id"], email, created["workspace_id"])).status_code == 201

    detail = api.get(f"{ADMIN}/workspaces/{created['workspace_id']}", headers=admin.headers).json()
    assert (detail["owner_email"], detail["plan_key"]) == (email, "founding")
    assert api.post(f"{ADMIN}/users", headers=admin.headers,
                    json={"email": email, "full_name": "Again", **WHY}).status_code == 400  # already exists


def test_create_a_login_inside_an_existing_workspace(api, admin):
    owner = register(api)
    email = new_email()
    body = {"email": email, "full_name": "Team Mate", "workspace_id": owner.workspace_id, "role": "admin", **WHY}
    assert api.post(f"{ADMIN}/users", json={**body, "new_workspace_name": "Both"},
                    headers=admin.headers).status_code == 422
    assert api.post(f"{ADMIN}/users", json={**body, "role": "owner"}, headers=admin.headers).status_code == 400
    r = api.post(f"{ADMIN}/users", json=body, headers=admin.headers)
    assert r.status_code == 201, r.text

    members = api.get(f"/api/v1/workspaces/{owner.workspace_id}/members", headers=owner.headers).json()
    assert {(m["email"], m["role"]) for m in members} == {(owner.email, "owner"), (email, "admin")}
    # The customer's own approval setting is theirs: staff adding a member does not flip it.
    ws = api.get(f"/api/v1/workspaces/{owner.workspace_id}", headers=owner.headers).json()
    assert ws["allow_self_approval"] is True


def test_a_new_setup_link_cancels_the_old_one_and_resets_a_password(api, admin):
    email = new_email()
    created = api.post(f"{ADMIN}/users", headers=admin.headers,
                       json={"email": email, "full_name": "Forgetful", **WHY}).json()
    user_url = f"{ADMIN}/users/{created['user_id']}"
    pending = api.get(user_url, headers=admin.headers).json()["pending_setup_link"]
    assert pending["purpose"] == "account_setup"

    second = api.post(f"{user_url}/setup-link", json=WHY, headers=admin.headers)
    assert second.status_code == 200, second.text
    old = api.post("/api/v1/auth/set-password",
                   json={"token": token_of(created["setup_link"]), "password": "first-password"})
    assert old.status_code == 400  # cancelled by the newer link
    assert api.post("/api/v1/auth/set-password", json={
        "token": token_of(second.json()["setup_link"]), "password": "first-password"}).status_code == 200
    assert login(api, email, "first-password").status_code == 200

    # Forgotten password: same mechanism, and every existing session ends.
    reset = api.post(f"{user_url}/setup-link", json={"reason": "forgot password"}, headers=admin.headers).json()
    assert api.get(user_url, headers=admin.headers).json()["pending_setup_link"]["purpose"] == "password_reset"
    assert len(api.get(user_url, headers=admin.headers).json()["sessions"]) == 1
    assert api.post("/api/v1/auth/set-password", json={
        "token": token_of(reset["setup_link"]), "password": "second-password"}).status_code == 200
    assert api.get(user_url, headers=admin.headers).json()["sessions"] == []
    assert login(api, email, "first-password").status_code == 401
    assert login(api, email, "second-password").status_code == 200

    links = [r for r in audit_rows(api, admin, entity_id=created["user_id"], action="SETUP_LINK")]
    assert len(links) == 3 and all("token" not in str(r["changes"]) for r in links)


def test_deactivate_and_force_logout(api, admin, db_exec):
    customer = register(api)
    user_url = f"{ADMIN}/users/{customer.user_id}"
    assert api.get("/api/v1/auth/me", headers=customer.headers).status_code == 200

    r = api.post(f"{user_url}/force-logout", json=WHY, headers=admin.headers)
    assert r.status_code == 200 and r.json()["sessions_ended"] == 1
    live = db_exec("SELECT count(*) FROM refresh_tokens WHERE user_id = :id AND NOT is_revoked",
                   id=customer.user_id).scalar()
    assert live == 0

    r = api.patch(user_url, json={"is_active": False, "reason": "left the company"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert api.get("/api/v1/auth/me", headers=customer.headers).status_code == 401  # at once
    assert login(api, customer.email, "password123").status_code == 403

    assert api.patch(user_url, json={"is_active": True, **WHY}, headers=admin.headers).json()["is_active"] is True
    assert login(api, customer.email, "password123").status_code == 200

    # Not on yourself.
    r = api.patch(f"{ADMIN}/users/{admin.user_id}", json={"is_active": False, **WHY}, headers=admin.headers)
    assert r.status_code == 400


def test_rename_a_login(api, admin, db_exec):
    customer = register(api, "Old Name")
    user_url = f"{ADMIN}/users/{customer.user_id}"

    r = api.patch(user_url, json={"full_name": "  New Name  ", **WHY}, headers=admin.headers)
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "New Name"
    assert api.get("/api/v1/auth/me", headers=customer.headers).json()["full_name"] == "New Name"
    # Recorded with the staff member's reason.
    row = db_exec("SELECT changes, reason FROM audit_events WHERE entity_id = :id AND action = 'UPDATE' "
                  "ORDER BY created_at DESC LIMIT 1", id=customer.user_id).one()
    assert row.changes == {"before": {"full_name": "Old Name"}, "after": {"full_name": "New Name"}}
    assert row.reason == "integration test"

    # A reason is required, an empty name is refused, and customers can't do it.
    assert api.patch(user_url, json={"full_name": "No Reason"}, headers=admin.headers).status_code == 422
    assert api.patch(user_url, json={"full_name": "   ", **WHY}, headers=admin.headers).status_code == 422
    assert api.patch(user_url, json={"full_name": "Hacked", **WHY}, headers=customer.headers).status_code in (403, 404)
    assert api.get("/api/v1/auth/me", headers=customer.headers).json()["full_name"] == "New Name"


def test_users_list_never_exposes_secrets(api, admin):
    customer = register(api)
    found = api.get(f"{ADMIN}/users", params={"search": customer.email}, headers=admin.headers).json()
    assert found["total"] == 1 and found["items"][0]["workspace_count"] == 1
    detail = api.get(f"{ADMIN}/users/{customer.user_id}", headers=admin.headers).json()
    assert detail["memberships"][0]["role"] == "owner" and len(detail["sessions"]) == 1
    assert "password" not in str(found).lower() and "hash" not in str(detail).lower()

    staff = api.get(f"{ADMIN}/users", params={"staff": True, "search": admin.email}, headers=admin.headers).json()
    assert [u["platform_role"] for u in staff["items"]] == ["super_admin"]


def test_platform_staff_are_managed_in_the_panel(api, admin):
    colleague = register(api)
    url = f"{ADMIN}/users/{colleague.user_id}/platform-role"
    assert api.get(f"{ADMIN}/overview", headers=colleague.headers).status_code == 404

    r = api.put(url, json={"platform_role": "super_admin", **WHY}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["platform_role"] == "super_admin"
    assert api.get(f"{ADMIN}/overview", headers=colleague.headers).status_code == 200

    # Nobody changes their own role, so one super admin always remains.
    own = api.put(f"{ADMIN}/users/{admin.user_id}/platform-role",
                  json={"platform_role": None, **WHY}, headers=admin.headers)
    assert own.status_code == 400

    assert api.put(url, json={"platform_role": None, **WHY}, headers=admin.headers).json()["platform_role"] is None
    assert api.get(f"{ADMIN}/overview", headers=colleague.headers).status_code == 404


# ── Members and ownership ──────────────────────────────────────────────
def test_members_and_ownership(api, admin, db_exec):
    owner, second, third = register(api), register(api), register(api)
    url = f"{ADMIN}/workspaces/{owner.workspace_id}"

    assert api.post(f"{url}/members", json={"email": second.email, **WHY}, headers=admin.headers).status_code == 201
    assert api.post(f"{url}/members", json={"email": second.email, **WHY}, headers=admin.headers).status_code == 400
    assert api.post(f"{url}/members", json={"email": new_email(), **WHY}, headers=admin.headers).status_code == 400
    assert api.post(f"{url}/members", json={"email": third.email, "role": "owner", **WHY},
                    headers=admin.headers).status_code == 400

    # The plan's member limit applies to staff too.
    set_plan(db_exec, owner, "free")
    assert_blocked(api.post(f"{url}/members", json={"email": third.email, **WHY}, headers=admin.headers),
                   "limit_reached", "max_members")
    set_plan(db_exec, owner, "founding")
    assert api.post(f"{url}/members", json={"email": third.email, **WHY}, headers=admin.headers).status_code == 201

    member_url = f"{url}/members/{second.user_id}"
    assert api.patch(member_url, json={"role": "admin", **WHY}, headers=admin.headers).status_code == 200
    assert api.patch(f"{url}/members/{owner.user_id}", json={"role": "member", **WHY},
                     headers=admin.headers).status_code == 400   # the owner is not demoted this way
    assert api.delete(f"{url}/members/{owner.user_id}", params=WHY, headers=admin.headers).status_code == 400

    # Hand the workspace to the second member.
    r = api.post(f"{url}/transfer-ownership", headers=admin.headers,
                 json={"new_owner_user_id": second.user_id, "reason": "founder left"})
    assert r.status_code == 200 and r.json()["owner_email"] == second.email
    roles = {m["email"]: m["role"] for m in api.get(f"{url}/members", headers=admin.headers).json()}
    assert roles == {owner.email: "admin", second.email: "owner", third.email: "member"}
    # The customer API agrees: the owner-only switch now answers to the new owner.
    switch = {"allow_self_approval": False}
    ws_url = f"/api/v1/workspaces/{owner.workspace_id}"
    assert api.patch(ws_url, json=switch, headers=owner.headers).status_code == 403
    assert api.patch(ws_url, json=switch, headers=second.headers).status_code == 200

    assert api.delete(f"{url}/members/{third.user_id}", headers=admin.headers).status_code == 422  # no reason
    assert api.delete(f"{url}/members/{third.user_id}", params=WHY, headers=admin.headers).status_code == 200
    assert api.get(f"/api/v1/workspaces/{owner.workspace_id}", headers=third.headers).status_code == 404
    outsider = register(api)
    assert api.post(f"{url}/transfer-ownership", headers=admin.headers,
                    json={"new_owner_user_id": outsider.user_id, **WHY}).status_code == 404  # not a member


# ── Plans, switches, settings ──────────────────────────────────────────
def test_plans_can_be_created_changed_and_made_default(api, admin):
    plans = {p["key"]: p for p in api.get(f"{ADMIN}/plans", headers=admin.headers).json()}
    assert {"free", "pro", "founding"} <= set(plans) and plans["founding"]["is_default"] is True
    founding_id = plans["founding"]["id"]
    key = f"starter_{uuid.uuid4().hex[:6]}"

    r = api.post(f"{ADMIN}/plans", headers=admin.headers,
                 json={"key": key, "name": "Starter", "copy_from_key": "free", **WHY})
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["features"] == plans["free"]["features"] and plan["workspace_count"] == 0
    assert api.post(f"{ADMIN}/plans", headers=admin.headers,
                    json={"key": key, "name": "Again", **WHY}).status_code == 400
    assert api.post(f"{ADMIN}/plans", headers=admin.headers,
                    json={"key": "Bad Key!", "name": "X", **WHY}).status_code == 422
    plan_url = f"{ADMIN}/plans/{plan['id']}"

    r = api.put(f"{plan_url}/features/max_brands", json={"enabled": True, "limit": 3, **WHY}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["features"]["max_brands"] == {"enabled": True, "limit": 3}
    assert api.put(f"{plan_url}/features/scheduling", json={"enabled": True, "limit": 3, **WHY},
                   headers=admin.headers).status_code == 400
    assert api.put(f"{plan_url}/features/nope", json={"enabled": True, **WHY}, headers=admin.headers).status_code == 404

    try:
        r = api.post(f"{plan_url}/make-default", json=WHY, headers=admin.headers)
        assert r.status_code == 200 and r.json()["is_default"] is True
        newcomer = register(api)  # new sign-ups land on it, with its limits
        assert features_of(api, newcomer)["_plan"] == key
        assert features_of(api, newcomer)["max_brands"]["limit"] == 3
        # The default plan cannot be retired from under new sign-ups.
        assert api.patch(plan_url, json={"is_active": False, **WHY}, headers=admin.headers).status_code == 400
    finally:
        r = api.post(f"{ADMIN}/plans/{founding_id}/make-default", json=WHY, headers=admin.headers)
        assert r.status_code == 200 and r.json()["is_default"] is True
    assert features_of(api, register(api))["_plan"] == "founding"

    # Retired: its workspaces keep it, nobody new can be put on it.
    r = api.patch(plan_url, json={"is_active": False, "name": "Starter (old)", **WHY}, headers=admin.headers)
    assert r.status_code == 200 and (r.json()["is_active"], r.json()["name"]) == (False, "Starter (old)")
    assert r.json()["workspace_count"] == 1
    other = register(api)
    assert api.patch(f"{ADMIN}/workspaces/{other.workspace_id}", json={"plan_key": key, **WHY},
                     headers=admin.headers).status_code == 400
    assert api.post(f"{ADMIN}/plans/{plan['id']}/make-default", json=WHY, headers=admin.headers).status_code == 400


def test_global_switch_turns_a_feature_off_for_everyone(api, admin):
    customer = register(api)
    url = f"{ADMIN}/features/usage_export"
    keys = [f["key"] for f in api.get(f"{ADMIN}/features", headers=admin.headers).json()]
    assert "usage_export" in keys and len(keys) == len(FEATURES)
    try:
        r = api.patch(url, json={"global_enabled": False, "reason": "export is broken"}, headers=admin.headers)
        assert r.status_code == 200 and r.json()["global_enabled"] is False
        assert features_of(api, customer)["usage_export"]["enabled"] is False
    finally:
        assert api.patch(url, json={"global_enabled": True, **WHY}, headers=admin.headers).status_code == 200
    assert features_of(api, customer)["usage_export"]["enabled"] is True
    assert api.patch(f"{ADMIN}/features/nope", json={"global_enabled": False, **WHY},
                     headers=admin.headers).status_code == 404


def test_platform_setting_changes_behaviour_without_a_restart(api, admin):
    url = f"{ADMIN}/settings/setup_link_hours"
    setting = api.get(f"{ADMIN}/settings", headers=admin.headers).json()[0]
    assert (setting["key"], setting["value"], setting["default"]) == ("setup_link_hours", 48, 48)

    assert api.patch(url, json={"value": 0, **WHY}, headers=admin.headers).status_code == 400
    assert api.patch(url, json={"value": "soon", **WHY}, headers=admin.headers).status_code == 400
    assert api.patch(f"{ADMIN}/settings/nope", json={"value": 1, **WHY}, headers=admin.headers).status_code == 404
    try:
        assert api.patch(url, json={"value": 2, **WHY}, headers=admin.headers).json()[0]["value"] == 2
        created = api.post(f"{ADMIN}/users", headers=admin.headers,
                           json={"email": new_email(), "full_name": "Short Link", **WHY}).json()
        lifetime = datetime.fromisoformat(created["expires_at"]) - datetime.now(timezone.utc)
        assert timedelta(hours=1, minutes=55) < lifetime <= timedelta(hours=2)
    finally:
        assert api.patch(url, json={"value": 48, **WHY}, headers=admin.headers).status_code == 200


def test_templates_are_managed_here_and_read_by_customers(api, admin):
    customer = register(api)
    title = f"Opening offer {uuid.uuid4().hex[:6]}"
    r = api.post(f"{ADMIN}/templates", headers=admin.headers, json={
        "industry": "Bakery", "category": "promotional", "title": title,
        "template_text": "Fresh {{product}} today!", "suggested_hashtags": ["#fresh"], **WHY})
    assert r.status_code == 201, r.text
    template_id = r.json()["id"]

    def customer_sees() -> bool:
        items = api.get("/api/v1/templates", params={"search": title}, headers=customer.headers).json()["items"]
        return [t["id"] for t in items] == [template_id]

    assert customer_sees()
    r = api.patch(f"{ADMIN}/templates/{template_id}", headers=admin.headers,
                  json={"is_active": False, "title": title + " (old)", **WHY})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert not customer_sees()
    listed = api.get(f"{ADMIN}/templates", params={"search": title}, headers=admin.headers).json()
    assert [t["is_active"] for t in listed] == [False]  # staff still see it
    # Customers still cannot write templates.
    assert api.post("/api/v1/templates", json={}, headers=customer.headers).status_code == 405


# ── Customer content: look, never touch ────────────────────────────────
def test_staff_can_read_content_and_the_customer_can_see_that_they_did(api, admin):
    customer = register(api)
    acct = make_account(api, customer)
    post_id = approved_post(api, customer, caption="Our secret launch")
    publish_now(api, customer, post_id, [acct["id"]])
    ws = f"{ADMIN}/workspaces/{customer.workspace_id}"

    posts = api.get(f"{ws}/posts", params={"search": "secret"}, headers=admin.headers).json()
    assert posts["total"] == 1
    assert (posts["items"][0]["caption"], posts["items"][0]["author_email"]) == ("Our secret launch", customer.email)

    detail = api.get(f"{ADMIN}/posts/{post_id}", headers=admin.headers).json()
    assert detail["post"]["id"] == post_id and detail["workspace_id"] == customer.workspace_id
    assert [h["action"] for h in detail["history"]] == ["approved", "submitted"]
    assert [j["status"] for j in detail["jobs"]] == ["queued"]

    accounts = api.get(f"{ws}/social-accounts", headers=admin.headers).json()
    assert accounts[0]["id"] == acct["id"] and not any("token" in k and k != "token_expires_at" for k in accounts[0])
    assert len(api.get(f"{ws}/brands", headers=admin.headers).json()) == 1

    views = audit_rows(api, admin, workspace_id=customer.workspace_id, action="VIEW")
    assert {v["entity_type"] for v in views} == {"Workspace", "Post"}
    assert all(v["actor_platform_role"] == "super_admin" for v in views)

    # There is no admin route that changes a post, and the customer's own routes do not know the admin.
    assert api.patch(f"{ADMIN}/posts/{post_id}", json={"caption": "x"}, headers=admin.headers).status_code == 405
    assert api.patch(f"/api/v1/posts/{post_id}", json={"caption": "x"}, headers=admin.headers).status_code == 404
    assert api.get(f"/api/v1/workspaces/{customer.workspace_id}", headers=admin.headers).status_code == 404


# ── Usage: billing and catching misuse ─────────────────────────────────
def test_usage_report_flags_a_workspace_above_its_plan(api, admin, db_exec):
    customer = register(api)
    brand_id = new_brand(api, customer).json()["id"]
    new_brand(api, customer, "Second")
    new_post(api, customer, brand_id)
    new_post(api, customer, brand_id)
    url = f"{ADMIN}/workspaces/{customer.workspace_id}/usage"

    usage = api.get(url, headers=admin.headers).json()
    assert (usage["brands"], usage["members"], usage["posts_created"]) == (2, 1, 2)
    assert (usage["posts_logged_this_month"], usage["posts_in_table_this_month"]) == (2, 2)
    assert usage["over_limit"] == [] and usage["usage_mismatch"] is False
    assert usage["limits"]["max_brands"] is None  # founding: unlimited

    # Moved to a plan that allows 1 brand: it has 2, so it is flagged.
    set_plan(db_exec, customer, "free")
    usage = api.get(url, headers=admin.headers).json()
    assert usage["limits"]["max_brands"] == 1 and usage["over_limit"] == ["max_brands"]

    # Posts that exist but were never logged — a code path skipping the usage log.
    db_exec("DELETE FROM usage_logs WHERE workspace_id = :ws", ws=customer.workspace_id)
    usage = api.get(url, headers=admin.headers).json()
    assert (usage["posts_logged_this_month"], usage["posts_in_table_this_month"]) == (0, 2)
    assert usage["usage_mismatch"] is True

    problems = api.get(f"{ADMIN}/usage", params={"problems_only": True, "plan": "free", "limit": 200},
                       headers=admin.headers).json()
    assert customer.workspace_id in [r["workspace_id"] for r in problems["items"]]
    assert all(r["over_limit"] or r["usage_mismatch"] for r in problems["items"])

    report = api.get(f"{ADMIN}/usage", params={"format": "csv", "plan": "free"}, headers=admin.headers)
    assert report.status_code == 200 and report.headers["content-type"].startswith("text/csv")
    lines = report.text.strip().splitlines()
    assert lines[0].startswith("workspace_id,workspace_name,plan_key") and "limit_max_brands" in lines[0]
    mine = next(line for line in lines if line.startswith(customer.workspace_id))
    assert mine.endswith("max_brands,yes")


def test_usage_report_is_paged(api, admin):
    register(api), register(api)
    page = api.get(f"{ADMIN}/usage", params={"limit": 1, "page": 2}, headers=admin.headers).json()
    assert len(page["items"]) == 1 and page["total"] >= 3 and (page["page"], page["limit"]) == (2, 1)
