"""Admin platform schema (migrations 0005 + 0006): seed data, the rules the
database enforces itself, and the read-only admin database role."""
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from app.core.features import FEATURES
from tests.integration.conftest import _sync_url, register


# ── Seed data ──────────────────────────────────────────────────────────
def test_features_table_matches_code_registry(db_exec):
    rows = db_exec("SELECT key, value_type::text, category, global_enabled FROM features").all()
    in_db = {r.key: (r.value_type, r.category, r.global_enabled) for r in rows}
    in_code = {f.key: (f.value_type.value, f.category, f.global_enabled) for f in FEATURES}
    assert in_db == in_code


def test_plans_seeded_with_exactly_one_default(db_exec):
    plans = {r.key: r for r in db_exec("SELECT key, is_default, is_active FROM plans").all()}
    assert {"free", "pro", "founding"} <= set(plans)  # other tests may add plans of their own
    # Unlimited until the owner sets real plan values and picks the default.
    assert [k for k, p in plans.items() if p.is_default] == ["founding"]


def test_every_plan_has_a_value_for_every_feature(db_exec):
    counts = db_exec(
        "SELECT p.key, count(pf.feature_key) AS n FROM plans p "
        "LEFT JOIN plan_features pf ON pf.plan_id = p.id "
        "WHERE p.key IN ('free', 'pro', 'founding') GROUP BY p.key"
    ).all()
    assert {r.key: r.n for r in counts} == {k: len(FEATURES) for k in ("free", "pro", "founding")}


def test_founding_plan_is_everything_on_and_unlimited(db_exec):
    restricted = db_exec(
        "SELECT pf.feature_key FROM plan_features pf JOIN plans p ON p.id = pf.plan_id "
        "WHERE p.key = 'founding' AND (NOT pf.enabled OR pf.limit_value IS NOT NULL)"
    ).all()
    assert restricted == []


# ── Existing flows still work ──────────────────────────────────────────
def test_new_workspaces_start_on_the_default_plan_and_active(api, db_exec):
    actor = register(api)
    second = api.post("/api/v1/workspaces", json={"name": "Second"}, headers=actor.headers)
    assert second.status_code == 201, second.text

    rows = db_exec(
        "SELECT p.key, w.status::text AS status FROM workspaces w JOIN plans p ON p.id = w.plan_id "
        "WHERE w.owner_id = :uid", uid=actor.user_id,
    ).all()
    assert len(rows) == 2
    assert {(r.key, r.status) for r in rows} == {("founding", "active")}


def test_customers_have_no_platform_role_and_login_is_recorded(api, db_exec):
    actor = register(api)
    before = db_exec("SELECT platform_role, last_login_at FROM users WHERE id = :id", id=actor.user_id).one()
    assert before.platform_role is None and before.last_login_at is None

    r = api.post("/api/v1/auth/login", json={"email": actor.email, "password": "password123"})
    assert r.status_code == 200, r.text
    after = db_exec("SELECT last_login_at FROM users WHERE id = :id", id=actor.user_id).one()
    assert after.last_login_at is not None


# ── Rules the database enforces itself ─────────────────────────────────
def test_suspending_a_workspace_requires_a_reason(api, db_exec):
    actor = register(api)
    with pytest.raises(IntegrityError, match="ck_suspended_requires_reason"):
        db_exec("UPDATE workspaces SET status = 'suspended' WHERE id = :id", id=actor.workspace_id)
    db_exec("UPDATE workspaces SET status = 'suspended', suspended_reason = 'test' WHERE id = :id",
            id=actor.workspace_id)


def test_only_one_plan_can_be_the_default(db_exec):
    with pytest.raises(IntegrityError, match="uq_plans_single_default"):
        db_exec("UPDATE plans SET is_default = true WHERE key = 'pro'")  # founding already is


def test_limits_cannot_be_negative(db_exec):
    with pytest.raises(IntegrityError, match="ck_plan_features_limit_non_negative"):
        db_exec("UPDATE plan_features SET limit_value = -1 WHERE feature_key = 'max_brands'")


def test_one_live_alert_per_subject(db_exec):
    key = f"over_limit:{uuid.uuid4()}"
    insert = ("INSERT INTO admin_alerts (id, alert_type, dedupe_key, status) "
              "VALUES (:id, 'over_limit', :key, :status)")
    db_exec(insert, id=uuid.uuid4(), key=key, status="open")
    with pytest.raises(IntegrityError, match="uq_admin_alerts_live_dedupe"):
        db_exec(insert, id=uuid.uuid4(), key=key, status="acknowledged")
    # Once resolved, the same subject may raise a fresh alert.
    db_exec("UPDATE admin_alerts SET status = 'resolved' WHERE dedupe_key = :key", key=key)
    db_exec(insert, id=uuid.uuid4(), key=key, status="open")


# ── The admin database role ────────────────────────────────────────────
@pytest.fixture()
def as_admin_role(database):
    """Run SQL as the read-mostly `omnipost_admin` role. Each statement runs
    in its own transaction that is rolled back, so nothing here persists."""
    engine = create_engine(_sync_url())

    def run(sql: str, **params):
        with engine.connect() as conn:
            conn.execute(text("SET ROLE omnipost_admin"))
            try:
                result = conn.execute(text(sql), params)
                return result.all() if result.returns_rows else result.rowcount
            finally:
                conn.rollback()

    yield run
    engine.dispose()


@pytest.mark.parametrize("sql", [
    # Customer content can be read, never changed.
    "UPDATE posts SET caption = 'changed by admin'",
    "DELETE FROM posts",
    "INSERT INTO brands (id, workspace_id, name) VALUES (gen_random_uuid(), gen_random_uuid(), 'x')",
    "DELETE FROM post_media",
    "UPDATE publish_jobs SET status = 'queued'",
    "UPDATE social_accounts SET is_active = false",
    "UPDATE approval_logs SET rejection_reason = 'x'",
    # Secrets cannot be read.
    "SELECT password_hash FROM users",
    "SELECT * FROM users",
    "SELECT access_token_encrypted FROM social_accounts",
    "SELECT refresh_token_encrypted FROM social_accounts",
    "SELECT token_hash FROM refresh_tokens",
    "SELECT token_hash FROM user_setup_tokens",
    # A password cannot be set; a customer's own governance switch is theirs.
    "UPDATE users SET password_hash = 'x'",
    "UPDATE workspaces SET allow_self_approval = true",
    # Workspaces are suspended, never deleted (deleting cascades to content).
    "DELETE FROM workspaces",
    "DELETE FROM users",
    # The audit trail is append-only.
    "UPDATE audit_events SET user_email = 'x'",
    "DELETE FROM audit_events",
    # Feature definitions come from code; usage is written by the app.
    "UPDATE features SET name = 'x'",
    "DELETE FROM features",
    "UPDATE usage_logs SET operation = 'post_created'",
    "DELETE FROM usage_daily",
    "DELETE FROM plans",
])
def test_admin_role_is_refused(as_admin_role, sql):
    with pytest.raises(ProgrammingError, match="permission denied"):
        as_admin_role(sql)


@pytest.mark.parametrize("sql", [
    # Sees customer content and usage.
    "SELECT id, caption, status FROM posts",
    "SELECT * FROM brands",
    "SELECT * FROM post_media",
    "SELECT * FROM publish_jobs",
    "SELECT id, platform, account_name, needs_reauth FROM social_accounts",
    "SELECT * FROM usage_logs",
    "SELECT * FROM usage_daily",
    "SELECT * FROM audit_events",
    "SELECT id, email, is_active, platform_role, last_login_at FROM users",
    "SELECT id, user_id, ip_address, is_revoked FROM refresh_tokens",
    # Manages accounts.
    "UPDATE users SET is_active = false",
    "UPDATE workspaces SET status = 'suspended', suspended_reason = 'unpaid', suspended_at = now()",
    "UPDATE workspaces SET plan_id = (SELECT id FROM plans WHERE key = 'pro')",
    "UPDATE workspace_members SET role = 'admin' WHERE role = 'member'",
    "DELETE FROM workspace_members WHERE role = 'member'",
    "UPDATE refresh_tokens SET is_revoked = true",
    "DELETE FROM user_setup_tokens WHERE used_at IS NULL",
    # Manages platform settings.
    "UPDATE plan_features SET limit_value = 3 WHERE feature_key = 'max_brands'",
    "UPDATE features SET global_enabled = false, updated_at = now() WHERE key = 'linkedin_publishing'",
    "DELETE FROM workspace_feature_overrides",
    "UPDATE caption_templates SET is_active = false",
    "UPDATE admin_alerts SET status = 'acknowledged' WHERE status = 'open'",
    "INSERT INTO audit_events (id, user_email, user_name, entity_type, entity_id, action, reason) "
    "VALUES (gen_random_uuid(), 'a@b.c', 'Admin', 'Workspace', gen_random_uuid(), 'SUSPEND', 'unpaid')",
])
def test_admin_role_is_allowed(as_admin_role, sql):
    as_admin_role(sql)


def test_admin_role_can_create_a_login_and_a_workspace(as_admin_role, api):
    """The admin panel's own job: no hand-written SQL by the owner needed."""
    register(api)  # make sure a user exists to own the workspace
    as_admin_role(
        "WITH u AS (INSERT INTO users (id, email, password_hash, full_name) "
        "           VALUES (gen_random_uuid(), :email, '!', 'New Customer') RETURNING id) "
        "INSERT INTO workspaces (id, name, slug, owner_id, plan_id) "
        "SELECT gen_random_uuid(), 'New Co', :slug, u.id, (SELECT id FROM plans WHERE is_default) FROM u",
        email=f"{uuid.uuid4().hex[:10]}@example.com", slug=f"new-co-{uuid.uuid4().hex[:6]}",
    )
