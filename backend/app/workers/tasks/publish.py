"""Publishing pipeline.

Design (see docs/architecture):
- dispatch_due_jobs (Beat, every minute) scans publish_jobs and dispatches
  due work as immediate Celery tasks. FOR UPDATE SKIP LOCKED +
  `celery_task_id IS NULL` make the scan safe under concurrency.
- publish_post_task executes ONE job. Jobs OWN their status; the post's
  aggregate status is derived by a row-locked finalizer — tasks never
  last-write-wins each other on post.status.
- COMMIT BARRIER: the job is committed PROCESSING before the platform API
  call. A redelivered task that finds PROCESSING has an UNKNOWN outcome and
  stops (needs_review) instead of double-posting to a customer's page
  (Facebook's feed API has no idempotency key).
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

from celery import shared_task
from sqlalchemy import select

from app.core.exceptions import PermanentPublishError, RetryablePublishError
from app.core.security import compute_content_hash
from app.db.session import worker_session
from app.models import (
    ApprovalAction, ApprovalLog, AuditAction, JobStatus, OperationType,
    Post, PostStatus, PublishJob, SocialAccount, UsageLog,
)
from app.services.audit import record_audit_event
from app.services.encryption import decrypt_token
from app.services.publishing.factory import get_adapter
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

_TERMINAL = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.NEEDS_REVIEW}


@shared_task(name="app.workers.tasks.publish.dispatch_due_jobs")
def dispatch_due_jobs():
    """Beat task: dispatch every due, not-yet-dispatched job."""
    now = datetime.now(timezone.utc)
    dispatched = 0
    with worker_session() as db:
        due = db.execute(
            select(PublishJob)
            .where(
                PublishJob.status == JobStatus.QUEUED,
                PublishJob.celery_task_id.is_(None),
                PublishJob.scheduled_for.is_not(None),
                PublishJob.scheduled_for <= now,
            )
            .with_for_update(skip_locked=True)
            .limit(100)
        ).scalars().all()

        for job in due:
            result = publish_post_task.apply_async(kwargs={"job_id": str(job.id)})
            job.celery_task_id = result.id
            dispatched += 1

    if dispatched:
        logger.info(f"[Dispatcher] dispatched {dispatched} job(s)")
    return {"dispatched": dispatched}


def _finalize_post(db, post_id) -> None:
    """Derive the post's aggregate status from ALL of its jobs, under a row
    lock — the single place that writes post.status for publish outcomes."""
    post = db.execute(
        select(Post).where(Post.id == post_id).with_for_update()
    ).scalar_one_or_none()
    if post is None:
        return
    if post.status not in (PostStatus.SCHEDULED, PostStatus.PUBLISHING,
                           PostStatus.PUBLISHED, PostStatus.PARTIALLY_PUBLISHED, PostStatus.FAILED):
        return  # the post was edited/reset meanwhile — its state machine wins

    jobs = db.execute(select(PublishJob).where(PublishJob.post_id == post_id)).scalars().all()
    if not jobs:
        return

    active = [j for j in jobs if j.status not in _TERMINAL]
    completed = [j for j in jobs if j.status == JobStatus.COMPLETED]
    cancelled_only = all(j.status == JobStatus.CANCELLED for j in jobs)

    if active:
        post.status = PostStatus.PUBLISHING
        return
    if cancelled_only:
        return  # cancellation flows set the post status themselves

    results = {str(j.social_account_id): j.result for j in completed if j.result}
    if completed:
        post.publish_result = results
        post.published_at = post.published_at or datetime.now(timezone.utc)
        post.status = PostStatus.PUBLISHED if len(completed) == len(
            [j for j in jobs if j.status != JobStatus.CANCELLED]
        ) else PostStatus.PARTIALLY_PUBLISHED
    else:
        post.status = PostStatus.FAILED


def _fail_job(db, job: PublishJob, message: str, status: JobStatus = JobStatus.FAILED) -> None:
    job.status = status
    job.error_message = message
    job.processed_at = datetime.now(timezone.utc)
    _finalize_post(db, job.post_id)


def _retry_or_fail(task, db, job: PublishJob, exc: Exception):
    """Retry with jittered backoff while attempts remain, else fail the job.
    Unknown exceptions are NEVER classified as permanent."""
    if task.request.retries >= task.max_retries:
        _fail_job(db, job, f"Max retries exceeded: {exc}")
        logger.error(f"[Publish] job {job.id} failed after max retries: {exc}")
        return {"status": "failed", "error": str(exc)}

    job.status = JobStatus.QUEUED  # keep celery_task_id set — the Beat scan must not double-dispatch
    job.error_message = str(exc)
    post = db.get(Post, job.post_id)
    if post and post.status == PostStatus.PUBLISHING:
        post.status = PostStatus.SCHEDULED
        post.retry_count += 1
    db.commit()
    logger.warning(f"[Publish] job {job.id} temporary failure: {exc}. Retrying…")
    raise task.retry(exc=exc)


@shared_task(
    bind=True,
    name="app.workers.tasks.publish.publish_post_task",
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    acks_late=True,
    reject_on_worker_lost=True,
)
def publish_post_task(self, job_id: str):
    j_uuid = UUID(job_id)
    with worker_session() as db:
        job = db.get(PublishJob, j_uuid)
        if job is None:
            logger.error(f"[Publish] job {job_id} not found — nothing to do")
            return {"status": "aborted", "reason": "job_not_found"}

        # Guard 0a — DOUBLE-PUBLISH PROTECTION. PROCESSING on delivery means
        # a previous attempt crashed around the platform call: outcome
        # unknown; never blindly re-publish.
        if job.status == JobStatus.PROCESSING:
            logger.error(f"[Publish] job {job_id} delivered while PROCESSING — unknown outcome")
            _fail_job(db, job,
                      "Unknown outcome: a previous attempt crashed after dispatch. "
                      "Verify on the platform before retrying.",
                      status=JobStatus.NEEDS_REVIEW)
            return {"status": "needs_review"}

        # Guard 0b — cancelled/completed jobs delivered late never run.
        if job.status != JobStatus.QUEUED:
            return {"status": "skipped", "reason": f"job_{job.status.value}"}

        post = db.get(Post, job.post_id)
        social_account = db.get(SocialAccount, job.social_account_id)
        if post is None or social_account is None:
            _fail_job(db, job, "Post or social account was deleted before execution.")
            return {"status": "aborted", "reason": "record_missing"}

        # Guard 1 — post must still be in a publishable state.
        if post.status not in (PostStatus.SCHEDULED, PostStatus.PUBLISHING):
            job.status = JobStatus.CANCELLED
            job.error_message = f"Post status changed to {post.status.value} before publishing."
            return {"status": "cancelled", "reason": "status_changed"}

        # Guard 2 — tamper detection: recompute from ACTUAL content (caption
        # + media IDs) and compare to the approval record. Comparing two
        # stored columns would miss direct media mutations.
        actual_hash = compute_content_hash(post.caption or "", [str(m.id) for m in post.media])
        latest_approval = db.execute(
            select(ApprovalLog)
            .where(ApprovalLog.post_id == post.id, ApprovalLog.action == ApprovalAction.APPROVED)
            .order_by(ApprovalLog.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest_approval is None or latest_approval.content_hash_at_action != actual_hash:
            logger.error(f"[Publish] HASH MISMATCH for post {post.id} — aborting")
            _fail_job(db, job, "Content was modified after approval. Integrity check failed.")
            return {"status": "failed", "reason": "hash_mismatch"}

        # Guard 3 — account must be active.
        if not social_account.is_active:
            _fail_job(db, job, f"Social account '{social_account.account_name}' is disconnected.")
            return {"status": "failed", "reason": "account_inactive"}

        # Guard 4 — CROSS-TENANT protection: the account must belong to the
        # post's workspace. A tampered or mis-built job must never publish
        # through another tenant's connected account.
        brand = post.brand  # sync session: lazy load is safe
        if brand is None or social_account.workspace_id != brand.workspace_id:
            logger.error(f"[Publish] WORKSPACE MISMATCH post={post.id} account={social_account.id}")
            _fail_job(db, job, "Social account does not belong to this post's workspace.")
            return {"status": "failed", "reason": "workspace_mismatch"}

        # COMMIT BARRIER — PROCESSING is durable before the platform call.
        post.status = PostStatus.PUBLISHING
        job.status = JobStatus.PROCESSING
        job.started_at = datetime.now(timezone.utc)
        job.attempt_number = self.request.retries + 1
        db.commit()

        try:
            access_token = decrypt_token(social_account.access_token_encrypted)
            adapter = get_adapter(social_account.platform)

            # Publicly fetchable URLs for ingest-by-URL platforms (presigned
            # S3 GET). LocalStorage raises PermanentPublishError with a clear
            # message — except for mock tokens, where media is simulated too.
            if access_token.startswith("mock-"):
                media_urls = [f"https://example.invalid/mock/{m.id}" for m in post.media]
            else:
                media_urls = [get_storage().publish_url(m.storage_key) for m in post.media]

            result = adapter.publish(
                caption=post.caption,
                media_urls=media_urls,
                access_token=access_token,
                account_metadata=social_account.platform_metadata or {},
                hashtags=post.hashtags or [],
                cta=post.cta,
            )

            job.status = JobStatus.COMPLETED
            job.result = result  # already filtered by the adapter contract
            job.processed_at = datetime.now(timezone.utc)

            db.add(UsageLog(workspace_id=brand.workspace_id, user_id=None,
                            operation=OperationType.POST_PUBLISHED,
                            meta={"post_id": str(post.id), "platform": social_account.platform.value}))
            record_audit_event(
                db, action=AuditAction.PUBLISH, entity_type="Post", entity_id=post.id,
                workspace_id=brand.workspace_id, user_id=None,
                user_email="(worker)", user_name="(publish worker)",
                changes={"after": {"platform": social_account.platform.value,
                                   "platform_post_id": result.get("platform_post_id")}},
            )
            _finalize_post(db, post.id)
            logger.info(f"[Publish] job {job.id} → {social_account.platform.value} OK")
            return {"status": "published", "platform_post_id": result.get("platform_post_id")}

        except PermanentPublishError as exc:
            logger.error(f"[Publish] permanent failure job {job.id}: {exc}")
            _fail_job(db, job, str(exc))
            return {"status": "failed", "error": str(exc)}
        except RetryablePublishError as exc:
            return _retry_or_fail(self, db, job, exc)
        except Exception as exc:  # noqa: BLE001 — unknown ≠ permanent
            return _retry_or_fail(self, db, job, exc)
