"""Tell people when a post fails to publish.

Adds one value to notification_type: `publish_failed`, written when a post
becomes "failed" or "partly published" (workers/tasks/publish.py,
_finalize_post). Until now the bell and email only covered approvals.

Revision ID: 0011_publish_failed_notice
Revises: 0010_email_outbox
"""
from alembic import op

revision = "0011_publish_failed_notice"
down_revision = "0010_email_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'publish_failed'")


def downgrade() -> None:
    # PostgreSQL cannot drop an enum value; remove the rows that use it.
    op.execute("DELETE FROM notifications WHERE type::text = 'publish_failed'")
