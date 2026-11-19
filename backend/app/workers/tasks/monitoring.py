"""Publishing health check, every 5 minutes.

The two symptoms that mean customers' posts are not going out:
- jobs still QUEUED well after their time: the scheduler (beat) or the
  workers are down, or messages are being lost;
- many jobs FAILED recently: a platform outage, an expired app token, a bug.

Each is logged at ERROR, which Sentry (when SENTRY_DSN is set) turns into an
alert. Logged once per run while the problem lasts, so it can't be missed.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.db.session import worker_session
from app.models import JobStatus, PublishJob
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

OVERDUE_AFTER = timedelta(minutes=10)
FAILURE_WINDOW = timedelta(hours=1)
FAILURE_ALERT_COUNT = 5


@celery_app.task(name="app.workers.tasks.monitoring.check_publishing_health")
def check_publishing_health() -> dict:
    now = datetime.now(timezone.utc)
    with worker_session() as db:
        overdue, oldest = db.execute(
            select(func.count(), func.min(PublishJob.scheduled_for)).where(
                PublishJob.status == JobStatus.QUEUED,
                PublishJob.scheduled_for <= now - OVERDUE_AFTER,
            )
        ).one()
        failed = db.scalar(
            select(func.count()).where(
                PublishJob.status.in_([JobStatus.FAILED, JobStatus.NEEDS_REVIEW]),
                PublishJob.processed_at >= now - FAILURE_WINDOW,
            )
        )

    if overdue:
        late_minutes = int((now - oldest).total_seconds() // 60)
        logger.error("[Health] %d publish job(s) overdue, oldest %d min late: are beat and the workers running?",
                     overdue, late_minutes)
    if failed >= FAILURE_ALERT_COUNT:
        logger.error("[Health] %d publish job(s) failed or need review in the last hour", failed)
    return {"overdue": overdue, "failed_last_hour": failed}
