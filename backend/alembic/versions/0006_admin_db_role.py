"""Database role for the admin panel: customer content is read-only.

The admin API will connect as a login that is a member of `omnipost_admin`
instead of as the application's own database user. The grants below make
the database itself enforce the admin rules, so a bug in admin code cannot
break them:

- customer content (brands, posts, media, approvals, publish jobs, social
  accounts) can be read, never changed;
- passwords, session tokens, setup-link tokens and social access tokens
  cannot be read at all;
- a user's password cannot be set (no UPDATE on users.password_hash);
- the audit trail can be added to, never edited or deleted.

The role is created WITHOUT login. The admin API reaches it in one of two
ways (see app/db/session.py):

- default: it connects as the application's own database user and switches
  to this role for the whole connection. The migration user is made a
  member of the role below so that switch is allowed.
- stricter: a deployment creates a separate login and points
  ADMIN_DATABASE_URL at it, so the admin API never holds the application
  user's credentials:

      CREATE ROLE omnipost_admin_app LOGIN PASSWORD '...' IN ROLE omnipost_admin;

Needs the migration user to be allowed to create roles (CREATEROLE). A new
table gets no grant here, so the admin role cannot see it until a later
migration grants access on purpose.

Revision ID: 0006_admin_db_role
Revises: 0005_admin_platform
"""
from alembic import op

revision = "0006_admin_db_role"
down_revision = "0005_admin_platform"
branch_labels = None
depends_on = None

ROLE = "omnipost_admin"

# (privileges, table, columns or None for the whole table)
_GRANTS = [
    # ── Accounts: created and changed from the admin panel ────────────
    ("SELECT", "users", ["id", "email", "full_name", "avatar_url", "is_active", "platform_role",
                         "last_login_at", "theme_preference", "created_at", "updated_at"]),
    ("INSERT", "users", None),  # a new login starts with an unusable password hash
    ("UPDATE", "users", ["email", "full_name", "is_active", "platform_role", "updated_at"]),

    ("SELECT, INSERT", "workspaces", None),
    ("UPDATE", "workspaces", ["name", "owner_id", "plan_id", "status", "suspended_at",
                              "suspended_reason", "updated_at"]),

    ("SELECT, INSERT, DELETE", "workspace_members", None),
    ("UPDATE", "workspace_members", ["role"]),

    # Sessions: list them and force a logout — never read a token hash.
    ("SELECT", "refresh_tokens", ["id", "user_id", "expires_at", "is_revoked", "ip_address",
                                  "user_agent", "created_at"]),
    ("UPDATE", "refresh_tokens", ["is_revoked"]),

    # Setup links: issue one and cancel unused ones — never read a token hash.
    ("SELECT", "user_setup_tokens", ["id", "user_id", "purpose", "expires_at", "used_at",
                                     "created_by_user_id", "created_at"]),
    ("INSERT, DELETE", "user_setup_tokens", None),

    # ── Platform settings ─────────────────────────────────────────────
    ("SELECT, INSERT, UPDATE", "plans", None),
    ("SELECT, INSERT, UPDATE", "plan_features", None),
    ("SELECT", "features", None),
    ("UPDATE", "features", ["global_enabled", "updated_at"]),  # the kill switch only
    ("SELECT, INSERT, UPDATE, DELETE", "workspace_feature_overrides", None),
    ("SELECT", "platform_settings", None),
    ("UPDATE", "platform_settings", ["value", "updated_by_user_id", "updated_at"]),
    ("SELECT, INSERT, UPDATE", "caption_templates", None),
    ("SELECT", "admin_alerts", None),
    ("UPDATE", "admin_alerts", ["status", "resolved_at", "resolved_by_user_id", "resolution_note"]),

    # ── Audit trail: append-only ──────────────────────────────────────
    ("SELECT, INSERT", "audit_events", None),

    # ── Usage: written by the app and the nightly job ─────────────────
    ("SELECT", "usage_logs", None),
    ("SELECT", "usage_daily", None),

    # ── Customer content: read-only ───────────────────────────────────
    ("SELECT", "brands", None),
    ("SELECT", "posts", None),
    ("SELECT", "post_media", None),
    ("SELECT", "approval_logs", None),
    ("SELECT", "publish_jobs", None),
    # Everything except the encrypted access and refresh tokens.
    ("SELECT", "social_accounts", ["id", "workspace_id", "platform", "platform_account_id",
                                   "account_name", "account_type", "token_expires_at",
                                   "platform_metadata", "is_active", "needs_reauth",
                                   "connected_at", "updated_at"]),
]


def upgrade() -> None:
    # Roles belong to the whole database server, so the role may already
    # exist (another database on the same server, or a re-run).
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}') THEN
                CREATE ROLE {ROLE} NOLOGIN;
            END IF;
        END
        $$;
    """)
    # Membership lets the application's database user run the admin API as
    # this role. A superuser needs no membership; a user who may not grant
    # it gets a notice instead of a failed migration (use ADMIN_DATABASE_URL).
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
                EXECUTE format('GRANT {ROLE} TO %I', current_user);
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'could not add % to {ROLE}; set ADMIN_DATABASE_URL to a login in that role', current_user;
        END
        $$;
    """)
    op.execute(f"GRANT USAGE ON SCHEMA public TO {ROLE}")
    for privileges, table, columns in _GRANTS:
        if columns:
            column_list = ", ".join(columns)
            privileges = ", ".join(f"{p.strip()} ({column_list})" for p in privileges.split(","))
        op.execute(f"GRANT {privileges} ON {table} TO {ROLE}")


def downgrade() -> None:
    # Revoking on a table also revokes its column-level grants. The role
    # itself is left in place: it is shared by every database on the server.
    op.execute(f"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM {ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {ROLE}")
