"""Background jobs for the approver picker & client approval links.

- notify_expired_links      every minute: tell the sharer once when a link expired
- release_stale_assignments every minute: D12 fall-back for changes made in the
                            admin panel (member removed, role lowered, account
                            deactivated). The admin API's database role cannot
                            write customer content, so this sweep does it.
- scan_approval_link_abuse  every 15 minutes: link-guessing and volume alerts
- cleanup_notifications     daily: drop bell entries older than 90 days
- send_approval_reminders   every 5 minutes: deadline reminders and escalation
                            (docs/approval_reminders_certificate_plan.md §2)

Plan: docs/client_approval_link_plan.md §4.6, §4.6b.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import aliased

from app.core.dependencies import APPROVER_ROLES
from app.core.settings_registry import SETTINGS_BY_KEY
from app.db.session import worker_session
from app.models import (
    AdminAlert, AdminAlertType, AlertSeverity, ApprovalAction, ApprovalLink, ApprovalLog, ApprovalReminder,
    Brand, BrandContact, NotificationType, PlatformSetting, Post, PostStatus, ReminderChannel,
    ReminderStage, User, Workspace, WorkspaceMember, WorkspaceStatus,
)
from app.services import approval_deadlines as deadlines
from app.services import approvals as reviewers
from app.services import email as mailer
from app.services.features import resolve_features_bulk_sync
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


# ── Approval deadlines (0009) ──────────────────────────────────────────
_STAGE_NOTIFICATION = {
    ReminderStage.DUE_SOON: NotificationType.APPROVAL_DUE_SOON,
    ReminderStage.OVERDUE: NotificationType.APPROVAL_OVERDUE,
    ReminderStage.ESCALATED: NotificationType.APPROVAL_ESCALATED,
}


def _latest_submission_id():
    return (select(ApprovalLog.id)
            .where(ApprovalLog.post_id == Post.id, ApprovalLog.action == ApprovalAction.SUBMITTED)
            .order_by(ApprovalLog.created_at.desc()).limit(1)
            .correlate(Post).scalar_subquery())


def _managers(db, workspace: Workspace, cache: dict) -> list:
    if workspace.id not in cache:
        cache[workspace.id] = list(db.scalars(
            select(WorkspaceMember.user_id)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(WorkspaceMember.workspace_id == workspace.id,
                   WorkspaceMember.role.in_(APPROVER_ROLES), User.is_active.is_(True))
        ).all())
    return cache[workspace.id]


def _open_links(db, post: Post) -> list:
    """The post's undecided, unrevoked links for its current content, newest first."""
    return list(db.scalars(
        select(ApprovalLink).where(ApprovalLink.post_id == post.id, ApprovalLink.decided_at.is_(None),
                                   ApprovalLink.revoked_at.is_(None),
                                   ApprovalLink.content_hash_at_share == post.content_hash)
        .order_by(ApprovalLink.created_at.desc())
    ).all())


def _client_status(db, post: Post) -> tuple[list, str]:
    """Who shared the post's open links, and whether the client opened one."""
    links = _open_links(db, post)
    sharers = [link.created_by for link in links] or [post.created_by]
    if any(link.first_viewed_at for link in links):
        seen = "They opened the link but haven't decided."
    elif links:
        seen = "They haven't opened the link yet."
    else:
        seen = "There's no open link for them."
    return sharers, seen


def _reminder(db, *, post: Post, workspace: Workspace, stage: ReminderStage, when: str,
              managers: list) -> tuple[list, str]:
    """(recipients, message) for one stage. Reminders go to people who can
    act: the assigned manager, the managers, or (for a client) whoever
    shared the link, since only they can nudge the client (plan R1a)."""
    assignee = reviewers.current_assignee(post)
    label = reviewers.post_label(post)
    deciders = [m for m in managers if workspace.allow_self_approval or m != post.created_by]
    waiting_for = assignee.name or reviewers.ANY_MANAGER
    if stage == ReminderStage.ESCALATED:
        return deciders + [post.created_by], (
            f"Overdue: {label} passed its deadline ({when}) and is still waiting for {waiting_for}. "
            "Any manager can approve it."
        )
    if assignee.contact_id:
        sharers, seen = _client_status(db, post)
        if stage == ReminderStage.DUE_SOON:
            return sharers, (f"{assignee.name} hasn't answered {label} yet. It's needed by {when}. "
                             f"{seen} Send a reminder?")
        return sharers, f"{assignee.name} missed the deadline for {label} ({when}). {seen} Send a reminder?"
    recipients = [assignee.user_id] if assignee.user_id else deciders
    if stage == ReminderStage.DUE_SOON:
        return recipients, f"Reminder: {label} needs approval by {when}."
    return recipients, f"{label} was due for approval at {when} and is now overdue."


def _email_client(db, *, post: Post, brand: Brand, workspace: Workspace, stage: ReminderStage,
                  when: str, now: datetime) -> bool:
    """Remind the client contact by email (plan R1b). Only when the agency
    switched it on, the client has an email and hasn't opted out, and they
    still hold a link that works — otherwise the sharer's reminder (above)
    is the one that matters. The link is never repeated: we don't have it."""
    if not workspace.email_client_reminders or post.assigned_contact_id is None:
        return False
    contact = db.get(BrandContact, post.assigned_contact_id)
    if not mailer.contact_can_be_emailed(contact):
        return False
    link = next((open_link for open_link in _open_links(db, post)
                 if open_link.contact_id == contact.id and open_link.expires_at > now), None)
    if link is None:
        return False
    sender = db.get(User, link.created_by)
    zone = ZoneInfo(deadlines.valid_zone(post.approval_due_tz) or "UTC")
    sent_on = link.created_at.astimezone(zone)
    to = mailer.Recipient(contact.email, contact.name)
    subject, text = mailer.client_reminder_email(
        to=to, agency=workspace.name, brand=brand.name,
        post_title=(post.title or "Untitled post").strip(), when=when,
        overdue=stage == ReminderStage.OVERDUE, sent_by=sender.full_name if sender else None,
        sent_on=f"{sent_on.day} {sent_on:%b}", stop_url=mailer.opt_out_url(contact.id),
    )
    mailer.queue(db, kind="client_reminder", to=to, subject=subject, text=text, workspace_id=workspace.id,
                 post_id=post.id, reply_to=sender.email if sender and sender.is_active else None)
    return True


@celery_app.task(name="app.workers.tasks.approvals.send_approval_reminders")
def send_approval_reminders() -> dict:
    now = datetime.now(timezone.utc)
    sent = released = 0
    with worker_session() as db:
        bounds = deadlines.due_bounds_sync(db)
        submission = _latest_submission_id()
        escalated_already = exists().where(ApprovalReminder.submission_log_id == submission,
                                           ApprovalReminder.stage == ReminderStage.ESCALATED)
        rows = db.execute(
            select(Post, Brand, Workspace, submission.label("submission_id"))
            .join(Brand, Brand.id == Post.brand_id)
            .join(Workspace, Workspace.id == Brand.workspace_id)
            .where(Post.status == PostStatus.PENDING_APPROVAL,
                   Post.approval_due_at.is_not(None),
                   Post.approval_due_at <= now + deadlines.DUE_SOON_WINDOW,
                   Brand.is_active.is_(True),
                   Workspace.status != WorkspaceStatus.SUSPENDED,
                   ~escalated_already)
            .order_by(Post.approval_due_at)
            .with_for_update(of=Post, skip_locked=True)
            .limit(500)
        ).all()
        if not rows:
            return {"sent": 0, "released": 0}

        features = resolve_features_bulk_sync(db, list({ws.id for _p, _b, ws, _s in rows}),
                                              ("approval_reminders", "email_notifications"))
        submitted_at = dict(db.execute(
            select(ApprovalLog.id, ApprovalLog.created_at)
            .where(ApprovalLog.id.in_([sid for *_x, sid in rows if sid is not None]))
        ).all())
        managers_cache: dict = {}
        for post, brand, workspace, submission_id in rows:
            if submission_id is None or not features[workspace.id]["approval_reminders"].enabled:
                continue
            stage = deadlines.current_stage(
                due_at=post.approval_due_at, submitted_at=submitted_at[submission_id],
                escalate_after_hours=deadlines.escalate_hours(bounds, brand), now=now,
            )
            if stage is None:
                continue
            # The unique index is the gate: a stage already sent this round
            # (or being sent by another worker right now) inserts nothing.
            inserted = db.execute(
                pg_insert(ApprovalReminder)
                .values(id=uuid.uuid4(), post_id=post.id, workspace_id=workspace.id,
                        submission_log_id=submission_id, stage=stage, channel=ReminderChannel.IN_APP,
                        recipient_name=post.assigned_name)
                .on_conflict_do_nothing(index_elements=["submission_log_id", "stage"],
                                        index_where=ApprovalReminder.stage != ReminderStage.MANUAL_NUDGE)
                .returning(ApprovalReminder.id)
            ).scalar()
            if inserted is None:
                continue
            when = deadlines.format_deadline(post.approval_due_at, post.approval_due_tz)
            recipients, message = _reminder(db, post=post, workspace=workspace, stage=stage, when=when,
                                            managers=_managers(db, workspace, managers_cache))
            reviewers.notify(db, workspace_id=workspace.id, user_ids=recipients,
                             type=_STAGE_NOTIFICATION[stage], post_id=post.id, message=message)
            if features[workspace.id]["email_notifications"].enabled:
                reviewers.email_users_sync(db, workspace=workspace, user_ids=recipients, post_id=post.id,
                                           kind=f"approval_{stage.value}", headline=message)
                if stage != ReminderStage.ESCALATED and _email_client(
                        db, post=post, brand=brand, workspace=workspace, stage=stage, when=when, now=now):
                    # Same transaction as the insert above: the row now says the client was emailed.
                    db.execute(update(ApprovalReminder).where(ApprovalReminder.id == inserted)
                               .values(channel=ReminderChannel.EMAIL))
            sent += 1
            if (stage == ReminderStage.ESCALATED and brand.approval_release_when_overdue
                    and reviewers.current_assignee(post).is_set):
                reviewers.release_one(db, post, workspace_id=workspace.id, reason="overdue", overdue=True)
                released += 1
    if sent:
        logger.info("[Approvals] sent %d deadline reminders, released %d", sent, released)
    return {"sent": sent, "released": released}
