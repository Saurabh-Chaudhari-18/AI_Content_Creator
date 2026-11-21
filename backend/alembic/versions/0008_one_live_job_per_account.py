"""At most one live publish job per post and account (double-post backstop).

The API already locks the post row while it creates jobs, so two "Post now"
clicks are handled one after the other (audit BIZ-01). This index makes the
database refuse a second QUEUED or PROCESSING job for the same post and
account even if a future code change forgets that lock: the losing request
gets a 409 instead of the customer's page getting the post twice.

Any duplicates already in the table (from before the lock existed) are kept,
but every one except the oldest is set to needs_review, so a person checks
the platform before anything is retried.

Revision ID: 0008_one_live_job_per_account
Revises: 0007_client_approval_links
"""
from alembic import op

revision = "0008_one_live_job_per_account"
down_revision = "0007_client_approval_links"
branch_labels = None
depends_on = None

INDEX = "uq_publish_jobs_one_live_per_account"


def upgrade() -> None:
    op.execute("""
        UPDATE publish_jobs AS j
        SET status = 'needs_review',
            error_message = 'Duplicate of another job for the same post and account, found during an upgrade. '
                            'Check the page before retrying.',
            processed_at = now()
        FROM (
            SELECT id, row_number() OVER (PARTITION BY post_id, social_account_id ORDER BY created_at, id) AS n
            FROM publish_jobs
            WHERE status IN ('queued', 'processing')
        ) AS ranked
        WHERE j.id = ranked.id AND ranked.n > 1
    """)
    op.execute(f"""
        CREATE UNIQUE INDEX {INDEX} ON publish_jobs (post_id, social_account_id)
        WHERE status IN ('queued', 'processing')
    """)


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX}")
