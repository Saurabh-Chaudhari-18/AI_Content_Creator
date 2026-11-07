"""New accounts start in the dark theme.

The product owner's design is dark-first. Existing users keep whatever is
stored for them; only the default for new rows changes.

Revision ID: 0004_dark_theme_default
Revises: 0003_user_theme_preference
"""
from alembic import op

revision = "0004_dark_theme_default"
down_revision = "0003_user_theme_preference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "theme_preference", server_default="dark")


def downgrade() -> None:
    op.alter_column("users", "theme_preference", server_default="light")
