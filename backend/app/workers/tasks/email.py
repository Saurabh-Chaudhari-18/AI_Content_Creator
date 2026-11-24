"""Deliver queued emails (docs/approval_reminders_certificate_plan.md §10).

- send_queued_emails   every minute (and on demand after a password-reset
                       request): send what is queued, retry failures up to
                       three times, wipe each body once it is sent or given up
- cleanup_email_outbox daily: drop finished rows older than 90 days

Each email is handled in its own short transaction, so a slow mail server
holds one row lock, never a batch. Two workers cannot send the same email:
the row is locked with SKIP LOCKED and re-checked before sending.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.core.settings_registry import SETTINGS_BY_KEY
from app.db.session import worker_session
from app.models import EmailOutbox, EmailStatus, PlatformSetting
from app.services import email as mailer
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

BATCH = 100
RETENTION = timedelta(days=90)
_FINISHED = (EmailStatus.SENT, EmailStatus.FAILED, EmailStatus.SKIPPED)


def _daily_cap(db) -> int:
    definition = SETTINGS_BY_KEY["max_emails_per_workspace_per_day"]
    value = db.scalar(select(PlatformSetting.value).where(PlatformSetting.key == definition.key))
    try:
        return definition.validate(value) if value is not None else definition.default
    except ValueError:
        return definition.default


def _over_cap(db, row: EmailOutbox, cap: int, now: datetime) -> bool:
    """Emails without a workspace (password reset) are never capped here;
    the request itself is rate-limited."""
    if row.workspace_id is None:
        return False
    sent = db.scalar(select(func.count(EmailOutbox.id)).where(
        EmailOutbox.workspace_id == row.workspace_id, EmailOutbox.status == EmailStatus.SENT,
        EmailOutbox.sent_at >= now - timedelta(days=1)))
    return (sent or 0) >= cap


def _finish(row: EmailOutbox, status: EmailStatus, error: str | None = None) -> None:
    row.status = status
    row.last_error = error
    row.body_encrypted = None      # nothing readable is kept once we are done with it


@celery_app.task(name="app.workers.tasks.email.send_queued_emails")
def send_queued_emails() -> dict:
    counts = {"sent": 0, "failed": 0, "skipped": 0, "retry": 0}
    with worker_session() as db:
        ids = list(db.scalars(
            select(EmailOutbox.id).where(EmailOutbox.status == EmailStatus.QUEUED)
            .order_by(EmailOutbox.created_at).limit(BATCH)
        ).all())
        cap = _daily_cap(db) if ids else 0

    for email_id in ids:
        with worker_session() as db:
            row = db.scalar(select(EmailOutbox).where(EmailOutbox.id == email_id,
                                                      EmailOutbox.status == EmailStatus.QUEUED)
                            .with_for_update(skip_locked=True))
            if row is None:        # another worker has it, or it is done
                continue
            now = datetime.now(timezone.utc)
            if not mailer.settings.email_enabled:
                _finish(row, EmailStatus.SKIPPED, "Email is switched off on this server.")
                counts["skipped"] += 1
                continue
            if _over_cap(db, row, cap, now):
                _finish(row, EmailStatus.SKIPPED, "The workspace reached its daily email limit.")
                counts["skipped"] += 1
                continue
            row.attempts += 1
            try:
                mailer.deliver(mailer.outgoing_from_row(row))
            except Exception as exc:  # noqa: BLE001 — any delivery problem is retried
                # The class name only: an SMTP error text can echo addresses or credentials.
                reason = exc.__class__.__name__
                if row.attempts >= mailer.MAX_ATTEMPTS:
                    _finish(row, EmailStatus.FAILED, reason)
                    counts["failed"] += 1
                    logger.error("[Email] gave up on %s email %s after %d attempts (%s)",
                                 row.kind, row.id, row.attempts, reason)
                else:
                    row.last_error = reason
                    counts["retry"] += 1
                continue
            _finish(row, EmailStatus.SENT)
            row.sent_at = now
            counts["sent"] += 1
    if any(counts.values()):
        logger.info("[Email] %s", counts)
    return counts


@celery_app.task(name="app.workers.tasks.email.cleanup_email_outbox")
def cleanup_email_outbox() -> dict:
    cutoff = datetime.now(timezone.utc) - RETENTION
    with worker_session() as db:
        deleted = db.execute(delete(EmailOutbox).where(EmailOutbox.status.in_(_FINISHED),
                                                       EmailOutbox.created_at < cutoff)).rowcount
    return {"deleted": deleted}
