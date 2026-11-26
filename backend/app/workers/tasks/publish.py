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
  stops instead of double-posting to a customer's page (Facebook's feed API
  has no idempotency key). If started_at is recent the other delivery is
  presumed still running and this one simply exits; if it is older than
  IN_PROGRESS_GRACE the worker is presumed dead and the job is parked as
  needs_review.
- The job row is SELECT ... FOR UPDATE SKIP LOCKED'd at pickup, so two
  concurrent deliveries can never both pass the guards.
- Success is committed the instant the adapter returns. Bookkeeping after
  that (usage log, audit row, post finalisation) can fail without ever
  triggering a retry that would publish again.
"""
import logging
from datetime import datetime, timedelta, timezone
import random
from uuid import UUID, uuid4

from app.workers.celery_app import celery_app
from sqlalchemy import select, update

from app.core.exceptions import PermanentPublishError, RetryablePublishError, UnknownOutcomePublishError
from app.core.security import post_content_hash, resolve_platform_content
from app.db.session import worker_session
from app.models import (
    ApprovalAction, ApprovalLog, AuditAction, Brand, JobStatus, NotificationType, OperationType,
    Post, PostStatus, PublishJob, SocialAccount, UsageLog, Workspace, WorkspaceMember, WorkspaceStatus,
)
from app.services.audit import record_audit_event
from app.services.encryption import decrypt_token
from app.services.publishing.factory import get_adapter
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

_TERMINAL = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.NEEDS_REVIEW}
IN_PROGRESS_GRACE = timedelta(minutes=15)  # platform calls take seconds; 15 min = a dead worker


# A queued job whose task message was sent this long after it was due and
# still has not started is presumed lost (broker restart, failed enqueue) and
# is dispatched again. A duplicate delivery is harmless: the task's row lock
# and status guards let exactly one delivery publish.
DISPATCH_STALE_AFTER = timedelta(minutes=15)


@celery_app.task(name="app.workers.tasks.publish.dispatch_due_jobs")
def dispatch_due_jobs():
    """Beat task: dispatch every due, not-yet-dispatched job.

    Claim first, enqueue second. The task ids are COMMITTED (and the row
    locks released) before any message is sent. Enqueueing while the rows
    were still locked let a fast worker find its job locked and exit,
    leaving it queued-with-a-task-id forever — a post that never went out.
    """
    now = datetime.now(timezone.utc)
    with worker_session() as db:
        # Re-arm jobs whose message was lost: queued, dispatched, and well
        # past due. Rows a task is working on right now are locked and skipped.
        stale_ids = db.execute(
            select(PublishJob.id)
            .where(
                PublishJob.status == JobStatus.QUEUED,
                PublishJob.celery_task_id.is_not(None),
                PublishJob.scheduled_for.is_not(None),
                PublishJob.scheduled_for <= now - DISPATCH_STALE_AFTER,
            )
            .with_for_update(skip_locked=True)
            .limit(100)
        ).scalars().all()
        if stale_ids:
            db.execute(
                update(PublishJob).where(PublishJob.id.in_(stale_ids)).values(celery_task_id=None)
                .execution_options(synchronize_session=False)
            )
            logger.warning(f"[Dispatcher] re-dispatching {len(stale_ids)} job(s) whose task never started")

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

        claimed: list[tuple[str, str]] = []
        for job in due:
            job.celery_task_id = uuid4().hex
            claimed.append((str(job.id), job.celery_task_id))
    # Committed: the rows are unlocked and carry their task ids.

    dispatched = 0
    for job_id, task_id in claimed:
        try:
            publish_post_task.apply_async(kwargs={"job_id": job_id}, task_id=task_id)
            dispatched += 1
        except Exception:  # noqa: BLE001 — the stale sweep above re-dispatches it
            logger.exception(f"[Dispatcher] could not enqueue job {job_id}; it will be retried")

    if dispatched:
        logger.info(f"[Dispatcher] dispatched {dispatched} job(s)")
    return {"dispatched": dispatched}


_PLATFORM_NAME = {"facebook": "Facebook", "instagram": "Instagram", "linkedin": "LinkedIn"}


def _tell_about_failure(db, post: Post, jobs: list) -> None:
    """Never fail silently: when a post newly ends up failed or partly
    published, tell its author and the workspace's managers, in the bell and
    (when the plan has email) by email. Same transaction as the status."""
    from app.core.dependencies import APPROVER_ROLES
    from app.services import approvals as reviewers
    from app.services.features import resolve_features_bulk_sync

    brand = db.get(Brand, post.brand_id)
    workspace = db.get(Workspace, brand.workspace_id) if brand else None
    if workspace is None:
        return
    accounts = {a.id: a for a in db.execute(
        select(SocialAccount).where(SocialAccount.id.in_([j.social_account_id for j in jobs]))
    ).scalars().all()}

    def where(job) -> str:
        account = accounts.get(job.social_account_id)
        if account is None:
            return "an account"
        return f"{_PLATFORM_NAME.get(account.platform.value, account.platform.value)} ({account.account_name})"

    failed = [j for j in jobs if j.status == JobStatus.FAILED]
    unsure = [j for j in jobs if j.status == JobStatus.NEEDS_REVIEW]
    label = reviewers.post_label(post)
    parts = []
    if failed:
        parts.append(f"didn't go out on {', '.join(where(j) for j in failed)}")
    if unsure:
        parts.append(f"may or may not have gone out on {', '.join(where(j) for j in unsure)} "
                     "(check the page before retrying)")
    lead = "partly published: it " if post.status == PostStatus.PARTIALLY_PUBLISHED else ""
    message = f"{label} {lead}{' and '.join(parts)}. Open it to see why and retry."

    managers = db.execute(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.role.in_(APPROVER_ROLES))).scalars().all()
    recipients = [post.created_by, *managers]
    reviewers.notify(db, workspace_id=workspace.id, user_ids=recipients, type=NotificationType.PUBLISH_FAILED,
                     post_id=post.id, message=message)
    if resolve_features_bulk_sync(db, [workspace.id], ("email_notifications",))[workspace.id][
            "email_notifications"].enabled:
        reviewers.email_users_sync(db, workspace=workspace, user_ids=recipients, kind="publish_failed",
                                   headline=message, post_id=post.id)


def _finalize_post(db, post_id) -> None:
    """Derive the post's aggregate status from ALL of its jobs, under a row
    lock — the single place that writes post.status for publish outcomes."""
    post = db.execute(
        select(Post).where(Post.id == post_id).with_for_update()
    ).scalar_one_or_none()
    if post is None:
        return
    before = post.status
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

    # Once per outcome: a later job of the same run settling again changes nothing.
    if post.status in (PostStatus.FAILED, PostStatus.PARTIALLY_PUBLISHED) and post.status != before:
        _tell_about_failure(db, post, jobs)


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

    # Exponential backoff with jitter: ~1, 2, 4 minutes, capped at 15. (A
    # manual task.retry() ignores the decorator's retry_backoff settings.)
    countdown = int(min(900, 60 * 2 ** task.request.retries) * random.uniform(0.75, 1.0))
    job.status = JobStatus.QUEUED  # keep celery_task_id set — the Beat scan must not double-dispatch
    job.error_message = str(exc)
    # Due again when the retry is: the stale-dispatch sweep measures from
    # here, so a pending retry is never mistaken for a lost message.
    job.scheduled_for = datetime.now(timezone.utc) + timedelta(seconds=countdown)
    post = db.get(Post, job.post_id)
    if post and post.status == PostStatus.PUBLISHING:
        post.status = PostStatus.SCHEDULED
        post.retry_count += 1
    db.commit()
    logger.warning(f"[Publish] job {job.id} temporary failure: {exc}. Retrying in {countdown}s…")
    raise task.retry(exc=exc, countdown=countdown)


@celery_app.task(
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
        # Row lock. SKIP LOCKED: if another delivery holds this job right
        # now, do nothing — it is handling it.
        job = db.execute(
            select(PublishJob).where(PublishJob.id == j_uuid).with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if job is None:
            exists = db.get(PublishJob, j_uuid) is not None
            if not exists:
                logger.error(f"[Publish] job {job_id} not found — nothing to do")
                return {"status": "aborted", "reason": "job_not_found"}
            logger.warning(f"[Publish] job {job_id} is locked by another worker — skipping")
            return {"status": "skipped", "reason": "locked"}

        # Guard 0a — DOUBLE-PUBLISH PROTECTION. PROCESSING on delivery means
        # another attempt already passed the commit barrier. Never re-publish.
        if job.status == JobStatus.PROCESSING:
            age = datetime.now(timezone.utc) - (job.started_at or datetime.now(timezone.utc))
            if age < IN_PROGRESS_GRACE:
                logger.warning(f"[Publish] job {job_id} already in progress ({age}); skipping duplicate delivery")
                return {"status": "skipped", "reason": "in_progress"}
            logger.error(f"[Publish] job {job_id} stuck PROCESSING for {age} — unknown outcome")
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

        # Guard 0c — a suspended workspace publishes nothing. The job fails
        # (visibly) rather than waiting: a post going out days late, the
        # moment the workspace is restored, is worse than one to retry.
        workspace = db.get(Workspace, social_account.workspace_id)
        if workspace is not None and workspace.status == WorkspaceStatus.SUSPENDED:
            _fail_job(db, job, "The workspace is suspended. Nothing was posted.")
            return {"status": "failed", "reason": "workspace_suspended"}

        # Guard 1 — post must still be in a publishable state.
        if post.status not in (PostStatus.SCHEDULED, PostStatus.PUBLISHING):
            job.status = JobStatus.CANCELLED
            job.error_message = f"Post status changed to {post.status.value} before publishing."
            return {"status": "cancelled", "reason": "status_changed"}

        # Guard 2 — tamper detection: recompute from ACTUAL content (caption
        # + media IDs) and compare to the approval record. Comparing two
        # stored columns would miss direct media mutations.
        actual_hash = post_content_hash(post)
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

            caption, hashtags, cta = resolve_platform_content(post, social_account.platform.value)
            result = adapter.publish(
                caption=caption,
                media_urls=media_urls,
                access_token=access_token,
                account_metadata=social_account.platform_metadata or {},
                hashtags=hashtags,
                cta=cta,
            )
        except UnknownOutcomePublishError as exc:
            # The request left the building; the platform may have posted it.
            logger.error(f"[Publish] UNKNOWN OUTCOME job {job.id}: {exc}")
            _fail_job(db, job, f"Unknown outcome — verify on the platform before retrying: {exc}",
                      status=JobStatus.NEEDS_REVIEW)
            return {"status": "needs_review", "error": str(exc)}
        except PermanentPublishError as exc:
            logger.error(f"[Publish] permanent failure job {job.id}: {exc}")
            _fail_job(db, job, str(exc))
            return {"status": "failed", "error": str(exc)}
        except RetryablePublishError as exc:
            return _retry_or_fail(self, db, job, exc)
        except Exception as exc:  # noqa: BLE001 — unknown ≠ permanent
            return _retry_or_fail(self, db, job, exc)

        # ── The platform accepted the post. Persist that FIRST, on its own
        # commit, so nothing below can cause a retry that publishes again.
        job.status = JobStatus.COMPLETED
        job.result = result  # already filtered by the adapter contract
        job.processed_at = datetime.now(timezone.utc)
        db.commit()

        try:
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
        except Exception:  # noqa: BLE001 — bookkeeping must never re-run the publish
            logger.exception(f"[Publish] job {job.id} published but post-publish bookkeeping failed")
            db.rollback()
        logger.info(f"[Publish] job {job.id} → {social_account.platform.value} OK")
        return {"status": "published", "platform_post_id": result.get("platform_post_id")}
