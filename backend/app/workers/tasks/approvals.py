"""Background jobs for the approver picker & client approval links.

- notify_expired_links      every minute: tell the sharer once when a link expired
- release_stale_assignments every minute: D12 fall-back for changes made in the
                            admin panel (member removed, role lowered, account
                            deactivated). The admin API's database role cannot
                            write customer content, so this sweep does it.
- scan_approval_link_abuse  every 15 minutes: link-guessing and volume alerts
- cleanup_notifications     daily: drop bell entries older than 90 days

Plan: docs/client_approval_link_plan.md §4.6, §4.6b.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import aliased

from app.core.dependencies import APPROVER_ROLES
from app.core.settings_registry import SETTINGS_BY_KEY
from app.db.session import worker_session
from app.models import (
    AdminAlert, AdminAlertType, AlertSeverity, ApprovalLink, Brand, BrandContact, NotificationType,
    PlatformSetting, Post, PostStatus, User, Workspace, WorkspaceMember,
)
from app.services import approvals as reviewers
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

NOTIFICATION_RETENTION = timedelta(days=90)


def _setting(db, key: str) -> int:
    definition = SETTINGS_BY_KEY[key]
    value = db.scalar(select(PlatformSetting.value).where(PlatformSetting.key == key))
    try:
        return definition.validate(value) if value is not None else definition.default
    except ValueError:
        return definition.default


@celery_app.task(name="app.workers.tasks.approvals.notify_expired_links")
def notify_expired_links() -> dict:
    now = datetime.now(timezone.utc)
    sent = 0
    with worker_session() as db:
        rows = db.execute(
            select(ApprovalLink, Post)
            .join(Post, Post.id == ApprovalLink.post_id)
            .where(ApprovalLink.expires_at <= now, ApprovalLink.decided_at.is_(None),
                   ApprovalLink.revoked_at.is_(None), ApprovalLink.expiry_notified_at.is_(None))
            .with_for_update(of=ApprovalLink, skip_locked=True)
            .limit(500)
        ).all()
        for link, post in rows:
            link.expiry_notified_at = now
            # Only worth telling while the post still waits for this answer.
            if post.status != PostStatus.PENDING_APPROVAL or post.content_hash != link.content_hash_at_share:
                continue
            reviewers.notify(
                db, workspace_id=link.workspace_id, user_ids=[link.created_by],
                type=NotificationType.LINK_EXPIRED, post_id=post.id, actor_name=link.recipient_name,
                message=f"{link.recipient_name}'s link for {reviewers.post_label(post)} expired "
                        "before they responded. Resend it?",
            )
            sent += 1
    return {"notified": sent}


@celery_app.task(name="app.workers.tasks.approvals.release_stale_assignments")
def release_stale_assignments() -> dict:
    released = 0
    with worker_session() as db:
        is_manager = exists().where(
            WorkspaceMember.workspace_id == Brand.workspace_id,
            WorkspaceMember.user_id == Post.assigned_approver_id,
            WorkspaceMember.role.in_(APPROVER_ROLES),
        )
        assignee_user = aliased(User)
        active_user = exists().where(assignee_user.id == Post.assigned_approver_id,
                                     assignee_user.is_active.is_(True))
        self_blocked = and_(Post.assigned_approver_id == Post.created_by,
                            Workspace.allow_self_approval.is_(False))
        live_contact = exists().where(BrandContact.id == Post.assigned_contact_id,
                                      BrandContact.is_active.is_(True), BrandContact.forgotten_at.is_(None))
        stale = db.execute(
            select(Post, Brand.workspace_id, User.is_active)
            .join(Brand, Brand.id == Post.brand_id)
            .join(Workspace, Workspace.id == Brand.workspace_id)
            .outerjoin(User, User.id == Post.assigned_approver_id)
            .where(Post.status == PostStatus.PENDING_APPROVAL,
                   or_(and_(Post.assigned_approver_id.is_not(None),
                            or_(~is_manager, ~active_user, self_blocked)),
                       and_(Post.assigned_contact_id.is_not(None),
                            or_(~live_contact, Brand.is_active.is_(False)))))
            .with_for_update(of=Post, skip_locked=True)
            .limit(500)
        ).all()
        for post, workspace_id, user_active in stale:
            if post.assigned_contact_id is not None:
                reason = "contact removed or brand deactivated"
            elif user_active is False:
                reason = "account deactivated"
            else:
                reason = "no longer a manager in this workspace"
            reviewers.release_one(db, post, workspace_id=workspace_id, reason=reason)
            released += 1
    if released:
        logger.info("[Approvals] released %d stale assignments", released)
    return {"released": released}


def _raise_alert(db, *, alert_type: AdminAlertType, dedupe_key: str, details: dict,
                 workspace_id=None, severity=AlertSeverity.WARNING) -> None:
    """One live alert per subject: refresh it instead of inserting a duplicate."""
    stmt = pg_insert(AdminAlert).values(
        alert_type=alert_type, severity=severity, details=details, dedupe_key=dedupe_key,
        workspace_id=workspace_id,
    )
    db.execute(stmt.on_conflict_do_update(
        index_elements=[AdminAlert.dedupe_key], index_where=AdminAlert.status != "resolved",
        set_={"details": stmt.excluded.details, "last_seen_at": func.now()},
    ))


@celery_app.task(name="app.workers.tasks.approvals.scan_approval_link_abuse")
def scan_approval_link_abuse() -> dict:
    now = datetime.now(timezone.utc)
    raised = 0
    with worker_session() as db:
        guess_threshold = _setting(db, "link_guessing_alert_threshold")
        volume_threshold = _setting(db, "link_volume_alert_threshold")

        # 1. Link guessing: invalid tokens per IP in the current and last hour.
        try:
            import redis

            from app.config import settings
            from app.core.rate_limit import INVALID_TOKEN_KEY

            r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
            for hour in {now.strftime("%Y%m%d%H"), (now - timedelta(hours=1)).strftime("%Y%m%d%H")}:
                for ip, count in (r.hgetall(INVALID_TOKEN_KEY.format(hour=hour)) or {}).items():
                    if int(count) >= guess_threshold:
                        _raise_alert(db, alert_type=AdminAlertType.LINK_GUESSING,
                                     dedupe_key=f"link_guessing:{ip}",
                                     details={"ip": ip, "invalid_tokens": int(count), "hour_utc": hour,
                                              "threshold": guess_threshold})
                        raised += 1
        except Exception:  # noqa: BLE001 — Redis down: skip this signal, keep the other
            logger.warning("[Approvals] link-guessing scan skipped (Redis unreachable)", exc_info=True)

        # 2. Volume spike: links created per workspace in the last 24 hours.
        since = now - timedelta(days=1)
        for workspace_id, count in db.execute(
            select(ApprovalLink.workspace_id, func.count(ApprovalLink.id))
            .where(ApprovalLink.created_at >= since)
            .group_by(ApprovalLink.workspace_id)
            .having(func.count(ApprovalLink.id) >= volume_threshold)
        ).all():
            _raise_alert(db, alert_type=AdminAlertType.LINK_VOLUME_SPIKE, workspace_id=workspace_id,
                         dedupe_key=f"link_volume_spike:{workspace_id}",
                         details={"links_last_24h": count, "threshold": volume_threshold})
            raised += 1
    return {"alerts": raised}


@celery_app.task(name="app.workers.tasks.approvals.cleanup_notifications")
def cleanup_notifications() -> dict:
    cutoff = datetime.now(timezone.utc) - NOTIFICATION_RETENTION
    from app.models import Notification

    with worker_session() as db:
        deleted = db.execute(delete(Notification).where(Notification.created_at < cutoff)).rowcount
    return {"deleted": deleted}
