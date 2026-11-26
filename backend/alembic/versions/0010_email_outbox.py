"""Outgoing email: outbox, preferences and the client opt-out.

Plan: docs/approval_reminders_certificate_plan.md §10 (decision R1b).

- email_outbox          one row per email. The API and the workers only INSERT;
                        the Beat job sends. The body is encrypted (it can hold a
                        password-reset link) and wiped once the email is sent or
                        given up on.
- users                 email_notifications: "email me about approvals" (on)
- workspaces            email_client_reminders: email clients automatically (off:
                        an agency decides when we may write to its clients)
- brand_contacts        email_opt_out_at: the client pressed "stop these reminders"
- features              email_notifications, ON in every existing plan
- omnipost_admin        counts only: never addresses, subjects or bodies

Revision ID: 0010_email_outbox
Revises: 0009_approval_deadlines_certs
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_email_outbox"
down_revision = "0009_approval_deadlines_certs"
branch_labels = None
depends_on = None

ROLE = "omnipost_admin"
_UUID = postgresql.UUID(as_uuid=True)
_NOW = sa.text("now()")

email_status = postgresql.ENUM("queued", "sent", "failed", "skipped", name="email_status", create_type=False)

_FEATURES = [
    ("email_notifications", "Email notifications",
     "Email managers about posts waiting for them, deadline reminders and overdue posts, "
     "and (when the workspace switches it on) remind clients by email.", "boolean", "Notifications"),
]


def upgrade() -> None:
    email_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "email_outbox",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True),
        sa.Column("post_id", _UUID, sa.ForeignKey("posts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("to_email", sa.String(255), nullable=False),
        sa.Column("to_name", sa.String(120), nullable=True),
        sa.Column("reply_to", sa.String(255), nullable=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body_encrypted", sa.Text(), nullable=True),
        sa.Column("status", email_status, nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_email_outbox_queued", "email_outbox", ["created_at"],
                    postgresql_where=sa.text("status = 'queued'"))
    op.create_index("ix_email_outbox_workspace_day", "email_outbox", ["workspace_id", "created_at"])

    op.add_column("users", sa.Column("email_notifications", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("workspaces", sa.Column("email_client_reminders", sa.Boolean(), nullable=False,
                                          server_default="false"))
    op.add_column("brand_contacts", sa.Column("email_opt_out_at", sa.DateTime(timezone=True), nullable=True))

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

    op.execute(f"GRANT SELECT (id, workspace_id, kind, status, created_at, sent_at) ON email_outbox TO {ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE ALL PRIVILEGES ON email_outbox FROM {ROLE}")
    keys = ", ".join(f"'{k}'" for k, *_ in _FEATURES)
    op.execute(f"DELETE FROM workspace_feature_overrides WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM plan_features WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM features WHERE key IN ({keys})")
    op.drop_column("brand_contacts", "email_opt_out_at")
    op.drop_column("workspaces", "email_client_reminders")
    op.drop_column("users", "email_notifications")
    op.drop_table("email_outbox")
    email_status.drop(op.get_bind(), checkfirst=True)
