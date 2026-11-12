"""Admin platform: super admin role, plans, per-customer features, usage checks.

Adds everything the admin panel stores (design:
docs/omnipost-docs/08_admin_panel_database.md):

- users.platform_role / last_login_at
- workspaces.plan_id / status / suspended_at / suspended_reason
- audit_events.actor_platform_role / reason, plus new audit actions
- plans, features, plan_features, workspace_feature_overrides,
  platform_settings, user_setup_tokens, usage_daily, admin_alerts

Seeds the feature list and three plans. Every workspace — the ones that
already exist and, for now, new ones too — is on the unlimited `founding`
plan, so nobody loses anything when this runs. The `free` and `pro` values
are placeholders: the owner sets the real ones from the admin panel, then
makes `free` the default for new sign-ups there.

Revision ID: 0005_admin_platform
Revises: 0004_dark_theme_default
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_admin_platform"
down_revision = "0004_dark_theme_default"
branch_labels = None
depends_on = None


platform_role = postgresql.ENUM("super_admin", name="platform_role", create_type=False)
workspace_status = postgresql.ENUM("active", "suspended", name="workspace_status", create_type=False)
feature_value_type = postgresql.ENUM("boolean", "limit", name="feature_value_type", create_type=False)
setup_token_purpose = postgresql.ENUM("account_setup", "password_reset",
                                      name="setup_token_purpose", create_type=False)
admin_alert_type = postgresql.ENUM(
    "over_limit", "usage_mismatch", "usage_spike", "repeat_signups", "high_failure_rate",
    name="admin_alert_type", create_type=False,
)
alert_severity = postgresql.ENUM("info", "warning", "critical", name="alert_severity", create_type=False)
alert_status = postgresql.ENUM("open", "acknowledged", "resolved", name="alert_status", create_type=False)

_NEW_ENUMS = [platform_role, workspace_status, feature_value_type, setup_token_purpose,
              admin_alert_type, alert_severity, alert_status]

_NEW_AUDIT_ACTIONS = [
    "VIEW", "SUSPEND", "REACTIVATE", "PLAN_CHANGE", "FEATURE_CHANGE", "SETTING_CHANGE",
    "OWNERSHIP_TRANSFER", "SETUP_LINK", "FORCE_LOGOUT", "ALERT_UPDATE",
]

_UUID = postgresql.UUID(as_uuid=True)
_NOW = sa.text("now()")
_EMPTY_OBJ = sa.text("'{}'::jsonb")


# ── Seed data ──────────────────────────────────────────────────────────
# A frozen copy of app/core/features.py as it was when this migration was
# written. Migrations must not import application code: the registry will
# keep changing, this migration must not.
# (key, name, description, value_type, category, global_enabled)
_FEATURES = [
    ("facebook_publishing", "Facebook publishing",
     "Connect Facebook pages and publish to them.", "boolean", "Publishing", True),
    ("instagram_publishing", "Instagram publishing",
     "Connect Instagram business accounts and publish to them.", "boolean", "Publishing", True),
    ("linkedin_publishing", "LinkedIn publishing",
     "Connect LinkedIn profiles and pages and publish to them.", "boolean", "Publishing", True),
    ("scheduling", "Scheduling and calendar",
     "Schedule posts for a later time and see them on the calendar.", "boolean", "Publishing", True),
    ("max_social_accounts", "Connected social accounts",
     "How many social accounts the workspace can connect.", "limit", "Publishing", True),
    ("caption_templates", "Smart Templates",
     "Use the caption template library when writing a post.", "boolean", "Content", True),
    ("approval_workflow", "Approval workflow",
     "Require a second person to approve a post before it is published.", "boolean", "Content", True),
    ("max_posts_per_month", "Posts per month",
     "How many posts the workspace can create in a calendar month.", "limit", "Content", True),
    ("max_brands", "Brands",
     "How many brands the workspace can manage.", "limit", "Workspace", True),
    ("max_members", "Team members",
     "How many people can belong to the workspace.", "limit", "Workspace", True),
    ("usage_export", "Usage export",
     "Download the workspace's usage as a file.", "boolean", "Workspace", True),
    ("video_uploads", "Video uploads",
     "Attach videos to posts (images are always allowed).", "boolean", "Media", True),
    ("max_storage_mb", "Media storage (MB)",
     "Total size of uploaded media the workspace can keep, in megabytes.", "limit", "Media", True),
    ("ai_captions", "AI captions",
     "Generate captions with AI.", "boolean", "AI", False),
    ("max_ai_tokens_per_month", "AI tokens per month",
     "How many AI tokens the workspace can use in a calendar month.", "limit", "AI", False),
]

# (key, name, description, is_default, sort_order)
_PLANS = [
    ("free", "Free", "Starter plan.", False, 10),
    ("pro", "Pro", "For growing teams.", False, 20),
    # The default until the owner has set real plan values: limits made up
    # here must never restrict a customer.
    ("founding", "Founding",
     "Everything on, no limits. Every workspace is on this plan until it is moved to a real one.",
     True, 90),
]

# What each plan includes: feature key -> True (on) / False (off) for a
# boolean feature, or a number / None (unlimited) for a limit feature.
# `free` and `pro` are PLACEHOLDERS — the owner sets the real values from
# the admin panel. `founding` is everything on, unlimited.
_PLAN_VALUES = {
    "free": {
        "facebook_publishing": True, "instagram_publishing": True, "linkedin_publishing": False,
        "scheduling": True, "max_social_accounts": 2,
        "caption_templates": True, "approval_workflow": False, "max_posts_per_month": 10,
        "max_brands": 1, "max_members": 1, "usage_export": False,
        "video_uploads": False, "max_storage_mb": 500,
        "ai_captions": False, "max_ai_tokens_per_month": 0,
    },
    "pro": {
        "facebook_publishing": True, "instagram_publishing": True, "linkedin_publishing": True,
        "scheduling": True, "max_social_accounts": 10,
        "caption_templates": True, "approval_workflow": True, "max_posts_per_month": 200,
        "max_brands": 5, "max_members": 5, "usage_export": True,
        "video_uploads": True, "max_storage_mb": 10_240,
        "ai_captions": True, "max_ai_tokens_per_month": 500_000,
    },
    "founding": {key: (True if value_type == "boolean" else None)
                 for key, _n, _d, value_type, _c, _g in _FEATURES},
}


def _plan_feature_rows(plan_ids: dict) -> list[dict]:
    types = {key: value_type for key, _n, _d, value_type, _c, _g in _FEATURES}
    rows = []
    for plan_key, values in _PLAN_VALUES.items():
        for feature_key, value in values.items():
            if types[feature_key] == "boolean":
                enabled, limit_value = bool(value), None
            else:  # limit: a number, or None for unlimited; 0 means "not included"
                enabled, limit_value = value != 0, value
            rows.append({"plan_id": plan_ids[plan_key], "feature_key": feature_key,
                         "enabled": enabled, "limit_value": limit_value})
    return rows


def upgrade() -> None:
    bind = op.get_bind()
    for enum in _NEW_ENUMS:
        enum.create(bind, checkfirst=True)
    # New enum values can be added inside the migration's transaction as
    # long as they are not used before it commits (PostgreSQL 12+).
    for value in _NEW_AUDIT_ACTIONS:
        op.execute(f"ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '{value}'")

    # ── Plans and features ────────────────────────────────────────────
    plans = op.create_table(
        "plans",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("key", sa.String(50), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.UniqueConstraint("key", name="plans_key_key"),
    )
    # Exactly one plan can be the default for new workspaces.
    op.create_index("uq_plans_single_default", "plans", ["is_default"], unique=True,
                    postgresql_where=sa.text("is_default"))

    features = op.create_table(
        "features",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("value_type", feature_value_type, nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("global_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )

    plan_features = op.create_table(
        "plan_features",
        sa.Column("plan_id", _UUID, sa.ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("feature_key", sa.String(100), sa.ForeignKey("features.key"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("limit_value", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.CheckConstraint("limit_value IS NULL OR limit_value >= 0",
                           name="ck_plan_features_limit_non_negative"),
    )
    op.create_index("ix_plan_features_feature_key", "plan_features", ["feature_key"])

    op.create_table(
        "workspace_feature_overrides",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature_key", sa.String(100), sa.ForeignKey("features.key"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("limit_value", sa.BigInteger(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("set_by_user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.UniqueConstraint("workspace_id", "feature_key", name="uq_workspace_feature_override"),
        sa.CheckConstraint("limit_value IS NULL OR limit_value >= 0",
                           name="ck_feature_override_limit_non_negative"),
    )
    op.create_index("ix_workspace_feature_overrides_workspace_id", "workspace_feature_overrides", ["workspace_id"])
    op.create_index("ix_workspace_feature_overrides_feature_key", "workspace_feature_overrides", ["feature_key"])

    platform_settings = op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("value_type", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by_user_id", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )

    # ── Login setup links ─────────────────────────────────────────────
    op.create_table(
        "user_setup_tokens",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("purpose", setup_token_purpose, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )
    op.create_index("ix_user_setup_tokens_user_id", "user_setup_tokens", ["user_id"])
    op.create_index("ix_user_setup_tokens_token_hash", "user_setup_tokens", ["token_hash"], unique=True)

    # ── Usage checks and alerts ───────────────────────────────────────
    op.create_table(
        "usage_daily",
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("metric", sa.String(100), primary_key=True),
        sa.Column("actual_value", sa.BigInteger(), nullable=False),
        sa.Column("logged_value", sa.BigInteger(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )
    op.create_index("ix_usage_daily_day", "usage_daily", ["day"])

    op.create_table(
        "admin_alerts",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("alert_type", admin_alert_type, nullable=False),
        sa.Column("severity", alert_severity, nullable=False, server_default="warning"),
        sa.Column("status", alert_status, nullable=False, server_default="open"),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default=_EMPTY_OBJ),
        sa.Column("dedupe_key", sa.String(200), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_admin_alerts_workspace_id", "admin_alerts", ["workspace_id"])
    op.create_index("ix_admin_alerts_alert_type", "admin_alerts", ["alert_type"])
    op.create_index("ix_admin_alerts_status", "admin_alerts", ["status"])
    # One live alert per subject — the nightly job updates it instead of
    # inserting a duplicate every night.
    op.create_index("uq_admin_alerts_live_dedupe", "admin_alerts", ["dedupe_key"], unique=True,
                    postgresql_where=sa.text("status <> 'resolved'"))

    # ── Seed: features, plans, what each plan includes ────────────────
    op.bulk_insert(features, [
        {"key": key, "name": name, "description": description, "value_type": value_type,
         "category": category, "global_enabled": global_enabled}
        for key, name, description, value_type, category, global_enabled in _FEATURES
    ])
    plan_ids = {key: uuid.uuid4() for key, *_ in _PLANS}
    op.bulk_insert(plans, [
        {"id": plan_ids[key], "key": key, "name": name, "description": description,
         "is_default": is_default, "sort_order": sort_order}
        for key, name, description, is_default, sort_order in _PLANS
    ])
    op.bulk_insert(plan_features, _plan_feature_rows(plan_ids))
    # Frozen copy of app/core/settings_registry.py; later settings are
    # created by the startup sync.
    op.bulk_insert(platform_settings, [
        {"key": "setup_link_hours", "value": 48, "value_type": "integer",
         "description": "How long a 'set your password' link stays valid, in hours."},
    ])

    # ── users ─────────────────────────────────────────────────────────
    op.add_column("users", sa.Column("platform_role", platform_role, nullable=True))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))

    # ── workspaces ────────────────────────────────────────────────────
    # plan_id: added empty, every existing workspace goes on `founding`,
    # then the column is locked to NOT NULL.
    op.add_column("workspaces", sa.Column("plan_id", _UUID, nullable=True))
    op.get_bind().execute(
        sa.text("UPDATE workspaces SET plan_id = :plan_id"), {"plan_id": plan_ids["founding"]}
    )
    op.alter_column("workspaces", "plan_id", nullable=False)
    op.create_foreign_key("workspaces_plan_id_fkey", "workspaces", "plans", ["plan_id"], ["id"])
    op.create_index("ix_workspaces_plan_id", "workspaces", ["plan_id"])

    op.add_column("workspaces", sa.Column("status", workspace_status, nullable=False, server_default="active"))
    op.add_column("workspaces", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("workspaces", sa.Column("suspended_reason", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_suspended_requires_reason", "workspaces",
        "NOT (status = 'suspended' AND suspended_reason IS NULL)",
    )

    # ── audit_events ──────────────────────────────────────────────────
    op.add_column("audit_events", sa.Column("actor_platform_role", sa.String(30), nullable=True))
    op.add_column("audit_events", sa.Column("reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_events", "reason")
    op.drop_column("audit_events", "actor_platform_role")

    op.drop_constraint("ck_suspended_requires_reason", "workspaces", type_="check")
    op.drop_column("workspaces", "suspended_reason")
    op.drop_column("workspaces", "suspended_at")
    op.drop_column("workspaces", "status")
    op.drop_index("ix_workspaces_plan_id", table_name="workspaces")
    op.drop_constraint("workspaces_plan_id_fkey", "workspaces", type_="foreignkey")
    op.drop_column("workspaces", "plan_id")

    op.drop_column("users", "last_login_at")
    op.drop_column("users", "platform_role")

    for table in (
        "admin_alerts", "usage_daily", "user_setup_tokens", "platform_settings",
        "workspace_feature_overrides", "plan_features", "features", "plans",
    ):
        op.drop_table(table)

    bind = op.get_bind()
    for enum in _NEW_ENUMS:
        enum.drop(bind, checkfirst=True)
    # The values added to audit_action stay: PostgreSQL cannot remove a
    # value from an enum type, and rows may already use them.
