from celery import Celery

from app.config import settings
from app.core.observability import init_error_reporting

# Failed tasks (a publish that crashed, a token refresh that broke) are
# reported with the task name; Sentry's Celery integration is automatic.
init_error_reporting("worker")

celery_app = Celery(
    "ai_content_creator",
    broker=settings.REDIS_URL,
    include=[
        "app.workers.tasks.publish",
        "app.workers.tasks.token_refresh",
        "app.workers.tasks.cleanup",
        "app.workers.tasks.approvals",
        "app.workers.tasks.monitoring",
        "app.workers.tasks.email",
    ],
)

celery_app.conf.update(
    # JSON only — pickle is a remote-code-execution vector.
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # No result backend: job state lives in the publish_jobs table.
    task_ignore_result=True,
    timezone="UTC",
    enable_utc=True,
    # Reliability
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        # ── SCHEDULING MODEL ──────────────────────────────────────────
        # No long-ETA dispatch (Redis re-delivers ETA tasks every
        # visibility_timeout and loses them on restarts). This Beat task
        # scans publish_jobs every minute and dispatches due jobs as
        # immediate tasks. Cancellation = a status update on the job row.
        "dispatch-due-publish-jobs": {
            "task": "app.workers.tasks.publish.dispatch_due_jobs",
            "schedule": 60.0,
        },
        "check-expiring-tokens": {
            "task": "app.workers.tasks.token_refresh.check_expiring_tokens",
            "schedule": 6 * 3600.0,
        },
        "cleanup-stale-jobs": {
            "task": "app.workers.tasks.cleanup.cleanup_stale_jobs",
            "schedule": 3600.0,
        },
        # ── Client approval links (docs/client_approval_link_plan.md §4.6) ──
        "notify-expired-approval-links": {
            "task": "app.workers.tasks.approvals.notify_expired_links",
            "schedule": 60.0,   # a 15-minute link is reported promptly
        },
        "release-stale-assignments": {
            "task": "app.workers.tasks.approvals.release_stale_assignments",
            "schedule": 60.0,
        },
        "scan-approval-link-abuse": {
            "task": "app.workers.tasks.approvals.scan_approval_link_abuse",
            "schedule": 15 * 60.0,
        },
        # Approval deadlines (docs/approval_reminders_certificate_plan.md §2.5)
        "send-approval-reminders": {
            "task": "app.workers.tasks.approvals.send_approval_reminders",
            "schedule": 5 * 60.0,
        },
        # Outgoing email (docs/approval_reminders_certificate_plan.md §10)
        "send-queued-emails": {
            "task": "app.workers.tasks.email.send_queued_emails",
            "schedule": 60.0,
        },
        "cleanup-email-outbox": {
            "task": "app.workers.tasks.email.cleanup_email_outbox",
            "schedule": 24 * 3600.0,
        },
        "cleanup-notifications": {
            "task": "app.workers.tasks.approvals.cleanup_notifications",
            "schedule": 24 * 3600.0,
        },
        # Overdue or failing posts → an ERROR log → a Sentry alert.
        "check-publishing-health": {
            "task": "app.workers.tasks.monitoring.check_publishing_health",
            "schedule": 5 * 60.0,
        },
    },
)
