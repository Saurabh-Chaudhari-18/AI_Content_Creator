"""Approver picker & client approval links.

Plan: docs/client_approval_link_plan.md.

- brand_contacts      saved client approvers per brand
- approval_links      no-login links (token stored as SHA-256 only)
- notifications       the in-app bell
- posts               current assignee (a manager OR a saved contact)
- workspaces          the agency's default link lifetime
- approval_logs       actor may be a client link or the system; assignee
                      snapshot and acted_by_assignee on every row
- enums               reassigned, new audit actions, new alert types
- features            client_approval_links + two limits, ON and unlimited
                      in every existing plan so nobody loses anything
- omnipost_admin      read access WITHOUT tokens, client contact details or
                      notifications (the super admin is a read-only observer)

Revision ID: 0007_client_approval_links
Revises: 0006_admin_db_role
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007_client_approval_links"
down_revision = "0006_admin_db_role"
branch_labels = None
depends_on = None

ROLE = "omnipost_admin"
_UUID = postgresql.UUID(as_uuid=True)
_NOW = sa.text("now()")

approval_link_decision = postgresql.ENUM("approved", "changes_requested",
                                         name="approval_link_decision", create_type=False)
notification_type = postgresql.ENUM(
    "assigned", "client_approved", "client_changes_requested", "manager_approved",
    "manager_rejected", "link_expired", "assignment_released",
    name="notification_type", create_type=False,
)

_NEW_AUDIT_ACTIONS = ["SHARE_LINK", "REVOKE_LINK", "ASSIGN", "CONTACT_CHANGE"]
_NEW_ALERT_TYPES = ["link_guessing", "link_volume_spike"]

# Frozen copy of the registry entries added with this migration.
# (key, name, description, value_type, category)
_FEATURES = [
    ("client_approval_links", "Client approval links",
     "Send a client a no-login link to approve or request changes to a post. "
     "Switching it off also stops every link already sent.", "boolean", "Approvals"),
    ("max_client_contacts_per_brand", "Client contacts per brand",
     "How many client contacts can be saved for each brand.", "limit", "Approvals"),
    ("max_open_approval_links", "Open client links",
     "How many unexpired, undecided client links the workspace can have at once.", "limit", "Approvals"),
]

_ADMIN_GRANTS = [
    ("SELECT", "brand_contacts", ["id", "brand_id", "workspace_id", "is_active", "created_at"]),
    ("SELECT", "approval_links", [
        "id", "post_id", "workspace_id", "contact_id", "content_hash_at_share", "version_at_share",
        "created_by", "expiry_minutes", "expires_at", "resent_from_id", "revoked_at", "revoke_reason",
        "expiry_notified_at", "first_viewed_at", "last_viewed_at", "view_count", "decision",
        "decided_at", "created_at",
    ]),
    # notifications: deliberately no grant.
]


def upgrade() -> None:
    bind = op.get_bind()
    approval_link_decision.create(bind, checkfirst=True)
    notification_type.create(bind, checkfirst=True)
    # New enum values are not USED in this transaction (PostgreSQL forbids
    # that); the approval_logs CHECK compares action::text instead.
    op.execute("ALTER TYPE approval_action ADD VALUE IF NOT EXISTS 'reassigned'")
    for value in _NEW_AUDIT_ACTIONS:
        op.execute(f"ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '{value}'")
    for value in _NEW_ALERT_TYPES:
        op.execute(f"ALTER TYPE admin_alert_type ADD VALUE IF NOT EXISTS '{value}'")

    # ── brand_contacts ────────────────────────────────────────────────
    op.create_table(
        "brand_contacts",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("brand_id", _UUID, sa.ForeignKey("brands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role_label", sa.String(80), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("forgotten_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.CheckConstraint("phone IS NOT NULL OR email IS NOT NULL OR forgotten_at IS NOT NULL",
                           name="ck_brand_contacts_reachable"),
    )
    op.create_index("ix_brand_contacts_brand_id", "brand_contacts", ["brand_id"])
    op.create_index("ix_brand_contacts_workspace_id", "brand_contacts", ["workspace_id"])

    # ── approval_links ────────────────────────────────────────────────
    op.create_table(
        "approval_links",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("post_id", _UUID, sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", _UUID, sa.ForeignKey("brand_contacts.id"), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("content_hash_at_share", sa.String(64), nullable=False),
        sa.Column("version_at_share", sa.Integer(), nullable=False),
        sa.Column("recipient_name", sa.String(120), nullable=False),
        sa.Column("recipient_contact", sa.String(255), nullable=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expiry_minutes", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resent_from_id", _UUID, sa.ForeignKey("approval_links.id"), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(40), nullable=True),
        sa.Column("expiry_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("decision", approval_link_decision, nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.CheckConstraint("(decision IS NULL) = (decided_at IS NULL)", name="ck_approval_links_decision_time"),
        sa.CheckConstraint("expiry_minutes > 0", name="ck_approval_links_expiry_positive"),
    )
    op.create_index("ix_approval_links_token_hash", "approval_links", ["token_hash"], unique=True)
    op.create_index("ix_approval_links_post_id", "approval_links", ["post_id"])
    op.create_index("ix_approval_links_workspace_id", "approval_links", ["workspace_id"])
    op.create_index("ix_approval_links_contact_id", "approval_links", ["contact_id"])
    op.create_index("ix_approval_links_open_expiry", "approval_links", ["expires_at"],
                    postgresql_where=sa.text(
                        "decided_at IS NULL AND revoked_at IS NULL AND expiry_notified_at IS NULL"))

    # ── notifications ─────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("workspace_id", _UUID, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", notification_type, nullable=False),
        sa.Column("post_id", _UUID, sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("actor_name", sa.String(120), nullable=True),
        sa.Column("message", sa.String(300), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
    )
    op.create_index("ix_notifications_workspace_id", "notifications", ["workspace_id"])
    op.create_index("ix_notifications_user_read", "notifications", ["user_id", "read_at"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])

    # ── posts: current assignee ───────────────────────────────────────
    op.add_column("posts", sa.Column("assigned_approver_id", _UUID,
                                     sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("posts", sa.Column("assigned_contact_id", _UUID,
                                     sa.ForeignKey("brand_contacts.id", ondelete="SET NULL"), nullable=True))
    op.add_column("posts", sa.Column("assigned_name", sa.String(120), nullable=True))
    op.create_check_constraint("ck_posts_single_assignee", "posts",
                               "NOT (assigned_approver_id IS NOT NULL AND assigned_contact_id IS NOT NULL)")
    op.create_index("ix_posts_pending_assignee", "posts", ["assigned_approver_id"],
                    postgresql_where=sa.text("status = 'pending_approval'"))

    # ── workspaces: default link lifetime ─────────────────────────────
    op.add_column("workspaces", sa.Column("approval_link_default_minutes", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_workspaces_link_default_positive", "workspaces",
                               "approval_link_default_minutes IS NULL OR approval_link_default_minutes > 0")

    # ── approval_logs: client / system actors, assignee snapshot ──────
    op.alter_column("approval_logs", "user_id", existing_type=_UUID, nullable=True)
    op.add_column("approval_logs", sa.Column("approval_link_id", _UUID,
                                             sa.ForeignKey("approval_links.id"), nullable=True))
    op.add_column("approval_logs", sa.Column("actor_name", sa.String(120), nullable=True))
    op.add_column("approval_logs", sa.Column("assigned_user_id", _UUID, nullable=True))
    op.add_column("approval_logs", sa.Column("assigned_contact_id", _UUID, nullable=True))
    op.add_column("approval_logs", sa.Column("assigned_name", sa.String(120), nullable=True))
    op.add_column("approval_logs", sa.Column("acted_by_assignee", sa.Boolean(), nullable=True))
    op.create_check_constraint("ck_approval_logs_single_actor", "approval_logs",
                               "NOT (user_id IS NOT NULL AND approval_link_id IS NOT NULL)")
    op.create_check_constraint(
        "ck_approval_logs_actor_required", "approval_logs",
        "user_id IS NOT NULL OR approval_link_id IS NOT NULL OR action::text = 'reassigned'",
    )

    # ── features: registered, ON and unlimited in every existing plan ─
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

    # ── admin role: counts, never secrets or client contact details ───
    for privileges, table, columns in _ADMIN_GRANTS:
        op.execute(f"GRANT {privileges} ({', '.join(columns)}) ON {table} TO {ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE ALL PRIVILEGES ON approval_links, brand_contacts FROM {ROLE}")
    keys = ", ".join(f"'{k}'" for k, *_ in _FEATURES)
    op.execute(f"DELETE FROM workspace_feature_overrides WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM plan_features WHERE feature_key IN ({keys})")
    op.execute(f"DELETE FROM features WHERE key IN ({keys})")

    op.drop_constraint("ck_approval_logs_actor_required", "approval_logs")
    op.drop_constraint("ck_approval_logs_single_actor", "approval_logs")
    # Client and system rows have no user; they cannot survive a NOT NULL user_id.
    op.execute("DELETE FROM approval_logs WHERE user_id IS NULL")
    for column in ("acted_by_assignee", "assigned_name", "assigned_contact_id", "assigned_user_id",
                   "actor_name", "approval_link_id"):
        op.drop_column("approval_logs", column)
    op.alter_column("approval_logs", "user_id", existing_type=_UUID, nullable=False)

    op.drop_constraint("ck_workspaces_link_default_positive", "workspaces")
    op.drop_column("workspaces", "approval_link_default_minutes")
    op.drop_index("ix_posts_pending_assignee", table_name="posts")
    op.drop_constraint("ck_posts_single_assignee", "posts")
    op.drop_column("posts", "assigned_name")
    op.drop_column("posts", "assigned_contact_id")
    op.drop_column("posts", "assigned_approver_id")

    op.drop_table("notifications")
    op.drop_table("approval_links")
    op.drop_table("brand_contacts")
    notification_type.drop(op.get_bind(), checkfirst=True)
    approval_link_decision.drop(op.get_bind(), checkfirst=True)
    # Enum values added to existing types stay (PostgreSQL cannot drop them);
    # rows using 'reassigned' were removed above with the client/system rows.
