"""Approval deadlines, reminders and approval certificates.

Plan: docs/approval_reminders_certificate_plan.md.

- posts                 approval_due_at / approval_due_tz: the "Needed by" of the
                        current (or latest) review round
- approval_logs         due_at on `submitted` rows: the deadline of that round
- brands / workspaces   default deadline, escalation delay, "move to any manager
                        when overdue", public certificate verification switch
- approval_reminders    append-only: one row per reminder (system or a person's
                        nudge); a partial unique index stops a stage being sent twice
- approval_certificates written once, at approval; survives post deletion
- enums                 three reminder notification types; reminder stage/channel
- features              approval_reminders, ON in every existing plan
- omnipost_admin        counts only (no snapshot content)

Revision ID: 0009_approval_deadlines_certs
Revises: 0008_one_live_job_per_account
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009_approval_deadlines_certs"
down_revision = "0008_one_live_job_per_account"
branch_labels = None
depends_on = None

ROLE = "omnipost_admin"
_UUID = postgresql.UUID(as_uuid=True)
_NOW = sa.text("now()")

reminder_stage = postgresql.ENUM("due_soon", "overdue", "escalated", "manual_nudge",
                                 name="reminder_stage", create_type=False)
reminder_channel = postgresql.ENUM("in_app", "whatsapp", "email", "copy",
                                   name="reminder_channel", create_type=False)

_NEW_NOTIFICATION_TYPES = ["approval_due_soon", "approval_overdue", "approval_escalated"]

# Frozen copy of the registry entry added with this migration.
_FEATURES = [
    ("approval_reminders", "Approval deadlines and reminders",
     "Give each post sent for approval a deadline, remind reviewers before and after it, "
     "and escalate overdue posts to the managers.", "boolean", "Approvals"),
]

_ADMIN_GRANTS = [
    ("SELECT", "approval_reminders", ["id", "workspace_id", "stage", "channel", "created_at"]),
    ("SELECT", "approval_certificates", ["id", "workspace_id", "created_at"]),
]


def upgrade() -> None:
    bind = op.get_bind()
    reminder_stage.create(bind, checkfirst=True)
    reminder_channel.create(bind, checkfirst=True)
    for value in _NEW_NOTIFICATION_TYPES:
        op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")

    # ── posts: deadline of the current / latest review round ──────────
    op.add_column("posts", sa.Column("approval_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("posts", sa.Column("approval_due_tz", sa.String(50), nullable=True))
    op.create_index("ix_posts_pending_due", "posts", ["approval_due_at"],
                    postgresql_where=sa.text("status = 'pending_approval'"))

    # ── approval_logs: deadline snapshot on submitted rows ────────────
    op.add_column("approval_logs", sa.Column("due_at", sa.DateTime(timezone=True), nullable=True))

    # ── brands: per-brand approval rules ──────────────────────────────
    op.add_column("brands", sa.Column("approval_due_hours", sa.Integer(), nullable=True))
    op.add_column("brands", sa.Column("approval_escalate_after_hours", sa.Integer(), nullable=True))
    op.add_column("brands", sa.Column("approval_release_when_overdue", sa.Boolean(), nullable=False,
                                      server_default="false"))
    op.create_check_constraint("ck_brands_approval_hours_positive", "brands",
                               "(approval_due_hours IS NULL OR approval_due_hours > 0) AND "
                               "(approval_escalate_after_hours IS NULL OR approval_escalate_after_hours > 0)")

    # ── workspaces: default deadline, verification switch ─────────────
    op.add_column("workspaces", sa.Column("approval_due_default_hours", sa.Integer(), nullable=True))
    op.add_column("workspaces", sa.Column("certificate_verification_enabled", sa.Boolean(), nullable=False,
                                          server_default="true"))
    op.create_check_constraint("ck_workspaces_due_default_positive", "workspaces",
                               "approval_due_default_hours IS NULL OR approval_due_default_hours > 0")

    # ── approval_reminders ────────────────────────────────────────────
    op.create_table(
        "approval_reminders",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("post_id", _UUID, sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_log_id", _UUID, sa.ForeignKey("approval_logs.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("stage", reminder_stage, nullable=False),
        sa.Column("channel", reminder_channel, nullable=False),
        sa.Column("recipient_name", sa.String(120), nullable=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )
    op.create_index("ix_approval_reminders_post_id", "approval_reminders", ["post_id"])
    op.create_index("ix_approval_reminders_workspace_id", "approval_reminders", ["workspace_id"])
    op.create_index("uq_approval_reminders_stage_once", "approval_reminders",
                    ["submission_log_id", "stage"], unique=True,
                    postgresql_where=sa.text("stage <> 'manual_nudge'"))

    # ── approval_certificates ─────────────────────────────────────────
    op.create_table(
        "approval_certificates",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("public_id", sa.String(16), nullable=False),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("brand_id", _UUID, sa.ForeignKey("brands.id", ondelete="SET NULL"), nullable=True),
        sa.Column("post_id", _UUID, sa.ForeignKey("posts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approval_log_id", _UUID, sa.ForeignKey("approval_logs.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )
    op.create_index("ix_approval_certificates_public_id", "approval_certificates", ["public_id"], unique=True)
    op.create_index("ix_approval_certificates_workspace_id", "approval_certificates", ["workspace_id"])
    op.create_index("ix_approval_certificates_post_id", "approval_certificates", ["post_id"])
    op.create_index("uq_approval_certificates_log", "approval_certificates", ["approval_log_id"], unique=True,
                    postgresql_where=sa.text("approval_log_id IS NOT NULL"))

    # ── feature: registered, ON in every existing plan ────────────────
    features = sa.table("features", sa.column("key"), sa.column("name"), sa.column("description"),
                        sa.column("value_type", postgresql.ENUM(name="feature_value_type", create_type=False)),
                        sa.column("category"), sa.column("global_enabled"), sa.column("is_active"))
    op.bulk_insert(features, [
        {"key": k, "name": n, "description": d, "value_type": t, "category": c,
         "global_enabled": True, "is_active": True}
        for k, n, d, t, c in _FEATURES
    ])
    for key, *_ in _FEATURES:
        op.execute(sa.text(
            "INSERT INTO plan_features (plan_id, feature_key, enabled, limit_value) "
            "SELECT id, :key, true, NULL FROM plans ON CONFLICT DO NOTHING"
        ).bindparams(key=key))

    # ── admin role: counts only ───────────────────────────────────────
    for privileges, table, columns in _ADMIN_GRANTS:
        op.execute(f"GRANT {privileges} ({', '.join(columns)}) ON {table} TO {ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE ALL PRIVILEGES ON approval_reminders, approval_certificates FROM {ROLE}")
    keys = ", ".join(f"'{k}'" for k, *_ in _FEATURES)
    op.execute(f"DELETE FROM workspace_feature_overrides WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM plan_features WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM features WHERE key IN ({keys})")

    op.drop_table("approval_certificates")
    op.drop_table("approval_reminders")

    op.drop_constraint("ck_workspaces_due_default_positive", "workspaces")
    op.drop_column("workspaces", "certificate_verification_enabled")
    op.drop_column("workspaces", "approval_due_default_hours")
    op.drop_constraint("ck_brands_approval_hours_positive", "brands")
    op.drop_column("brands", "approval_release_when_overdue")
    op.drop_column("brands", "approval_escalate_after_hours")
    op.drop_column("brands", "approval_due_hours")
    op.drop_column("approval_logs", "due_at")
    op.drop_index("ix_posts_pending_due", table_name="posts")
    op.drop_column("posts", "approval_due_tz")
    op.drop_column("posts", "approval_due_at")

    # Notifications of the new types cannot outlive their enum values' meaning.
    op.execute("DELETE FROM notifications WHERE type::text IN "
               "('approval_due_soon', 'approval_overdue', 'approval_escalated')")
    reminder_channel.drop(op.get_bind(), checkfirst=True)
    reminder_stage.drop(op.get_bind(), checkfirst=True)
    # Enum values added to notification_type stay (PostgreSQL cannot drop them).
