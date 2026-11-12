"""Plan features and limits — how a feature is decided, and that every
customer route enforces it. Values are changed straight in the database
here, exactly as the admin panel will, and must apply on the next request."""
import io
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import create_engine, text

from app.core.features import FEATURES
from app.services.features import resolve_features, sync_feature_registry

from .conftest import _sync_url, register, run_job
from .test_publishing import approved_post, make_account, post_status, publish_now

pytestmark = pytest.mark.integration


# ── Helpers ────────────────────────────────────────────────────────────
def set_plan(db_exec, actor, plan_key: str) -> None:
    db_exec("UPDATE workspaces SET plan_id = (SELECT id FROM plans WHERE key = :key) WHERE id = :ws",
            key=plan_key, ws=actor.workspace_id)


def set_override(db_exec, actor, feature: str, enabled: bool = True, limit=None, expires_at=None) -> None:
    db_exec(
        "INSERT INTO workspace_feature_overrides "
        "  (id, workspace_id, feature_key, enabled, limit_value, expires_at, reason, set_by_user_id) "
        "VALUES (:id, :ws, :feature, :enabled, :limit, :expires_at, 'test', :uid) "
        "ON CONFLICT (workspace_id, feature_key) DO UPDATE "
        "  SET enabled = :enabled, limit_value = :limit, expires_at = :expires_at",
        id=uuid.uuid4(), ws=actor.workspace_id, feature=feature, enabled=enabled,
        limit=limit, expires_at=expires_at, uid=actor.user_id,
    )


def features_of(api, actor) -> dict:
    r = api.get(f"/api/v1/workspaces/{actor.workspace_id}/features", headers=actor.headers)
    assert r.status_code == 200, r.text
    return {f["key"]: f for f in r.json()["features"]} | {"_plan": r.json()["plan_key"]}


def assert_blocked(response, kind: str, feature: str) -> None:
    assert response.status_code == 403, response.text
    assert response.headers["x-plan-restriction"] == kind
    assert response.headers["x-plan-feature"] == feature
    assert isinstance(response.json()["detail"], str)  # the web app shows this text as-is


def new_brand(api, actor, name="Brand"):
    return api.post(f"/api/v1/workspaces/{actor.workspace_id}/brands", json={"name": name}, headers=actor.headers)


def new_post(api, actor, brand_id):
    return api.post(f"/api/v1/brands/{brand_id}/posts", json={"caption": "hello"}, headers=actor.headers)


def add_member(api, owner, member, role="member"):
    return api.post(f"/api/v1/workspaces/{owner.workspace_id}/members",
                    json={"email": member.email, "role": role}, headers=owner.headers)


def mock_connect(api, actor, platform):
    account_id = f"mock-{platform}-{uuid.uuid4().hex[:8]}"
    return api.post(
        f"/api/v1/social/workspaces/{actor.workspace_id}/connect/mock",
        json={"platform": platform, "account_name": account_id, "platform_account_id": account_id},
        headers=actor.headers,
    )


def upload(api, actor, post_id, filename, data):
    return api.post("/api/v1/media/upload", data={"post_id": post_id},
                    files={"file": (filename, data)}, headers=actor.headers)


def png(side: int = 8, noise: bool = False) -> bytes:
    """A real PNG. With noise it does not compress: ~3 bytes per pixel."""
    pixels = os.urandom(side * side * 3) if noise else bytes(side * side * 3)
    out = io.BytesIO()
    Image.frombytes("RGB", (side, side), pixels).save(out, format="PNG")
    return out.getvalue()


MP4 = b"\x00\x00\x00\x18ftypisom" + bytes(64)  # enough of a header to be recognised as MP4


# ── How a feature is decided ───────────────────────────────────────────
def test_new_workspace_has_everything_and_no_limits(api):
    features = features_of(api, register(api))
    assert features.pop("_plan") == "founding"
    assert set(features) == {f.key for f in FEATURES}
    released = {f.key for f in FEATURES if f.global_enabled}
    assert {k for k, f in features.items() if f["enabled"]} == released  # AI is switched off for everyone
    assert all(f["limit"] is None for f in features.values())


def test_plan_change_applies_on_the_next_request(api, db_exec):
    owner = register(api)
    set_plan(db_exec, owner, "free")
    features = features_of(api, owner)
    assert features["_plan"] == "free"
    assert features["linkedin_publishing"]["enabled"] is False
    assert features["max_brands"] == {"key": "max_brands", "name": "Brands", "category": "Workspace",
                                      "value_type": "limit", "enabled": True, "limit": 1}


def test_override_beats_the_plan_until_it_expires(api, db_exec):
    owner = register(api)
    set_plan(db_exec, owner, "free")
    now = datetime.now(timezone.utc)

    set_override(db_exec, owner, "linkedin_publishing", enabled=True, expires_at=now + timedelta(days=14))
    set_override(db_exec, owner, "max_brands", limit=None)       # unlimited for this customer
    set_override(db_exec, owner, "scheduling", enabled=False)    # taken away from this customer
    features = features_of(api, owner)
    assert features["linkedin_publishing"]["enabled"] is True
    assert features["max_brands"]["limit"] is None
    assert features["scheduling"]["enabled"] is False

    set_override(db_exec, owner, "linkedin_publishing", enabled=True, expires_at=now - timedelta(seconds=1))
    assert features_of(api, owner)["linkedin_publishing"]["enabled"] is False  # trial over: back to the plan


def test_global_switch_turns_a_feature_off_for_everyone(api, db_exec):
    owner = register(api)
    set_override(db_exec, owner, "usage_export", enabled=True)
    try:
        db_exec("UPDATE features SET global_enabled = false WHERE key = 'usage_export'")
        assert features_of(api, owner)["usage_export"]["enabled"] is False  # even with an override
    finally:
        db_exec("UPDATE features SET global_enabled = true WHERE key = 'usage_export'")
    assert features_of(api, owner)["usage_export"]["enabled"] is True


def test_features_endpoint_is_members_only(api):
    owner, outsider = register(api), register(api)
    r = api.get(f"/api/v1/workspaces/{owner.workspace_id}/features", headers=outsider.headers)
    assert r.status_code == 404


def test_a_feature_missing_from_code_is_an_error_not_off():
    check = resolve_features(None, uuid.uuid4(), ("no_such_feature",))
    with pytest.raises(KeyError, match="no_such_feature"):
        check.send(None)


# ── Limits ─────────────────────────────────────────────────────────────
def test_brand_limit(api, db_exec):
    owner = register(api)
    set_plan(db_exec, owner, "free")  # 1 brand
    first = new_brand(api, owner)
    assert first.status_code == 201, first.text
    assert_blocked(new_brand(api, owner), "limit_reached", "max_brands")

    # Removing a brand frees its place.
    assert api.delete(f"/api/v1/brands/{first.json()['id']}", headers=owner.headers).status_code == 200
    assert new_brand(api, owner).status_code == 201

    # The admin raises the limit for this customer: applies at once.
    set_override(db_exec, owner, "max_brands", limit=2)
    assert new_brand(api, owner).status_code == 201
    assert_blocked(new_brand(api, owner), "limit_reached", "max_brands")


def test_a_limit_feature_switched_off_allows_none(api, db_exec):
    owner = register(api)
    set_override(db_exec, owner, "max_brands", enabled=False)
    assert_blocked(new_brand(api, owner), "feature_disabled", "max_brands")


def test_member_limit(api, db_exec):
    owner, second, third = register(api), register(api), register(api)
    set_plan(db_exec, owner, "free")  # 1 member: the owner
    assert_blocked(add_member(api, owner, second), "limit_reached", "max_members")

    set_override(db_exec, owner, "max_members", limit=2)
    assert add_member(api, owner, second).status_code == 200
    assert_blocked(add_member(api, owner, third), "limit_reached", "max_members")


def test_posts_per_month_limit_is_not_reset_by_deleting(api, db_exec):
    owner = register(api)
    brand_id = new_brand(api, owner).json()["id"]
    set_override(db_exec, owner, "max_posts_per_month", limit=2)

    first = new_post(api, owner, brand_id)
    assert first.status_code == 201, first.text
    assert new_post(api, owner, brand_id).status_code == 201
    assert_blocked(new_post(api, owner, brand_id), "limit_reached", "max_posts_per_month")

    assert api.delete(f"/api/v1/posts/{first.json()['id']}", headers=owner.headers).status_code == 200
    assert_blocked(new_post(api, owner, brand_id), "limit_reached", "max_posts_per_month")


def test_posts_from_last_month_do_not_count(api, db_exec):
    owner = register(api)
    brand_id = new_brand(api, owner).json()["id"]
    set_override(db_exec, owner, "max_posts_per_month", limit=1)
    assert new_post(api, owner, brand_id).status_code == 201
    db_exec("UPDATE usage_logs SET created_at = created_at - interval '32 days' WHERE workspace_id = :ws",
            ws=owner.workspace_id)
    assert new_post(api, owner, brand_id).status_code == 201


def test_social_account_limit_and_platform_features(api, db_exec):
    owner = register(api)
    set_plan(db_exec, owner, "free")  # Facebook + Instagram, 2 accounts, no LinkedIn
    assert_blocked(mock_connect(api, owner, "linkedin"), "feature_disabled", "linkedin_publishing")

    first = mock_connect(api, owner, "facebook")
    assert first.status_code == 201, first.text
    assert mock_connect(api, owner, "instagram").status_code == 201
    assert_blocked(mock_connect(api, owner, "facebook"), "limit_reached", "max_social_accounts")

    # Disconnecting frees a place.
    assert api.delete(f"/api/v1/social/accounts/{first.json()['id']}", headers=owner.headers).status_code == 200
    assert mock_connect(api, owner, "facebook").status_code == 201


def test_storage_limit_and_video_uploads(api, db_exec):
    owner = register(api)
    brand_id = new_brand(api, owner).json()["id"]
    post_id = new_post(api, owner, brand_id).json()["id"]

    set_override(db_exec, owner, "video_uploads", enabled=False)
    assert_blocked(upload(api, owner, post_id, "clip.mp4", MP4), "feature_disabled", "video_uploads")
    assert upload(api, owner, post_id, "small.png", png()).status_code == 201  # images are always allowed

    set_override(db_exec, owner, "max_storage_mb", limit=1)
    big = png(side=700, noise=True)
    assert len(big) > 1024 * 1024
    assert_blocked(upload(api, owner, post_id, "big.png", big), "limit_reached", "max_storage_mb")
    assert upload(api, owner, post_id, "small2.png", png()).status_code == 201  # still fits

    set_override(db_exec, owner, "max_storage_mb", limit=5)
    assert upload(api, owner, post_id, "big.png", big).status_code == 201


# ── Publishing ─────────────────────────────────────────────────────────
def test_scheduling_feature(api, db_exec):
    owner = register(api)
    acct = make_account(api, owner)
    post_id = approved_post(api, owner)
    set_override(db_exec, owner, "scheduling", enabled=False)

    when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = api.post(f"/api/v1/posts/{post_id}/schedule", headers=owner.headers,
                 json={"scheduled_at": when, "social_account_ids": [acct["id"]]})
    assert_blocked(r, "feature_disabled", "scheduling")
    assert post_status(api, owner, post_id) == "approved"

    publish_now(api, owner, post_id, [acct["id"]])  # posting right away is not "scheduling"


def test_platform_switched_off_stops_new_publishing_but_not_queued_jobs(api, db_exec):
    owner = register(api)
    acct = make_account(api, owner, platform="linkedin")
    queued_post, new_post_id = approved_post(api, owner), approved_post(api, owner)
    jobs = publish_now(api, owner, queued_post, [acct["id"]])  # queued while LinkedIn was allowed

    set_override(db_exec, owner, "linkedin_publishing", enabled=False)

    r = api.post(f"/api/v1/posts/{new_post_id}/publish-now", headers=owner.headers,
                 json={"social_account_ids": [acct["id"]]})
    assert_blocked(r, "feature_disabled", "linkedin_publishing")
    assert post_status(api, owner, new_post_id) == "approved"

    # The dry run says so before the user tries.
    check = api.post(f"/api/v1/posts/{new_post_id}/validate", headers=owner.headers,
                     json={"social_account_ids": [acct["id"]]}).json()
    assert check["ok"] is False
    assert "LinkedIn publishing isn't included in your plan." in check["results"][0]["errors"]

    # What was already queued still goes out.
    assert run_job(jobs[acct["id"]])["status"] == "published"
    assert post_status(api, owner, queued_post) == "published"


def test_retry_needs_the_platform_in_the_plan(api, db_exec):
    owner = register(api)
    acct = make_account(api, owner)
    post_id = approved_post(api, owner)
    jobs = publish_now(api, owner, post_id, [acct["id"]])
    db_exec("UPDATE social_accounts SET is_active = false WHERE id = :id", id=acct["id"])
    assert run_job(jobs[acct["id"]])["status"] == "failed"
    db_exec("UPDATE social_accounts SET is_active = true WHERE id = :id", id=acct["id"])

    set_override(db_exec, owner, "facebook_publishing", enabled=False)
    assert_blocked(api.post(f"/api/v1/posts/{post_id}/retry", json={}, headers=owner.headers),
                   "feature_disabled", "facebook_publishing")

    set_override(db_exec, owner, "facebook_publishing", enabled=True)
    assert api.post(f"/api/v1/posts/{post_id}/retry", json={}, headers=owner.headers).status_code == 200


# ── Approval workflow ──────────────────────────────────────────────────
def self_approval(api, actor) -> bool:
    return api.get(f"/api/v1/workspaces/{actor.workspace_id}", headers=actor.headers).json()["allow_self_approval"]


def set_self_approval(api, actor, allowed: bool):
    return api.patch(f"/api/v1/workspaces/{actor.workspace_id}",
                     json={"allow_self_approval": allowed}, headers=actor.headers)


def test_two_person_approval_needs_the_feature(api, db_exec):
    owner, second = register(api), register(api)
    set_override(db_exec, owner, "approval_workflow", enabled=False)

    assert_blocked(set_self_approval(api, owner, False), "feature_disabled", "approval_workflow")
    assert add_member(api, owner, second).status_code == 200
    assert self_approval(api, owner) is True  # not switched on automatically either

    set_override(db_exec, owner, "approval_workflow", enabled=True)
    assert set_self_approval(api, owner, False).status_code == 200


def test_losing_the_feature_never_weakens_a_rule_already_on(api, db_exec):
    owner, second = register(api), register(api)
    assert add_member(api, owner, second).status_code == 200
    assert self_approval(api, owner) is False  # switched on when the second member joined

    set_override(db_exec, owner, "approval_workflow", enabled=False)
    assert self_approval(api, owner) is False            # stays until the customer changes it
    assert set_self_approval(api, owner, True).status_code == 200   # relaxing it is always allowed
    assert_blocked(set_self_approval(api, owner, False), "feature_disabled", "approval_workflow")


# ── Smart Templates ────────────────────────────────────────────────────
def test_templates_feature(api, db_exec):
    owner = register(api)
    assert api.get("/api/v1/templates", headers=owner.headers).status_code == 200

    set_override(db_exec, owner, "caption_templates", enabled=False)
    assert_blocked(api.get("/api/v1/templates", headers=owner.headers), "feature_disabled", "caption_templates")
    assert_blocked(api.get(f"/api/v1/templates/{uuid.uuid4()}", headers=owner.headers),
                   "feature_disabled", "caption_templates")

    # A second workspace that has the feature: allowed there, still refused for the first.
    other = api.post("/api/v1/workspaces", json={"name": "Other"}, headers=owner.headers).json()["id"]
    assert api.get("/api/v1/templates", headers=owner.headers).status_code == 200
    assert api.get(f"/api/v1/templates?workspace_id={other}", headers=owner.headers).status_code == 200
    assert_blocked(api.get(f"/api/v1/templates?workspace_id={owner.workspace_id}", headers=owner.headers),
                   "feature_disabled", "caption_templates")


def test_templates_cannot_be_checked_against_someone_elses_workspace(api):
    owner, outsider = register(api), register(api)
    r = api.get(f"/api/v1/templates?workspace_id={owner.workspace_id}", headers=outsider.headers)
    assert r.status_code == 404


# ── Startup sync: code registry -> database ────────────────────────────
def test_sync_makes_the_features_table_match_the_code(database):
    engine = create_engine(_sync_url())
    with engine.connect() as conn:  # everything here is rolled back
        conn.execute(text("UPDATE features SET name = 'stale', is_active = false WHERE key = 'max_brands'"))
        conn.execute(text("UPDATE features SET global_enabled = false WHERE key = 'scheduling'"))
        conn.execute(text("DELETE FROM plan_features WHERE feature_key = 'usage_export'"))
        conn.execute(text("DELETE FROM workspace_feature_overrides WHERE feature_key = 'usage_export'"))
        conn.execute(text("DELETE FROM features WHERE key = 'usage_export'"))  # as if newly added in code
        conn.execute(text("INSERT INTO features (key, name, value_type, category) "
                          "VALUES ('removed_from_code', 'Old', 'boolean', 'Old')"))

        sync_feature_registry(conn)

        rows = {r.key: r for r in conn.execute(text("SELECT key, name, is_active, global_enabled FROM features"))}
        assert (rows["max_brands"].name, rows["max_brands"].is_active) == ("Brands", True)
        assert rows["scheduling"].global_enabled is False       # the kill switch belongs to the admin panel
        assert rows["usage_export"].is_active is True           # inserted
        assert rows["removed_from_code"].is_active is False     # kept, but retired
        assert {k for k, r in rows.items() if r.is_active} == {f.key for f in FEATURES}

        # A second run changes nothing.
        before = conn.execute(text("SELECT key, updated_at FROM features ORDER BY key")).all()
        sync_feature_registry(conn)
        assert conn.execute(text("SELECT key, updated_at FROM features ORDER BY key")).all() == before
        conn.rollback()
    engine.dispose()
