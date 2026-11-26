"""Approval certificates: proof of exactly what was approved, by whom, when.

Plan: docs/approval_reminders_certificate_plan.md §3.

- A certificate is written ONCE, in the same transaction as the `approved`
  history row (manager or client). It is never updated.
- The snapshot holds everything needed to read it after the post is gone:
  the content as hashed, the wording per platform, the media list, who
  submitted and approved, the client link facts and the review trail.
- What happened later (superseded by a re-approval, published, post deleted)
  is worked out when it is read, from the live tables.
- Posts approved before this feature get a certificate the first time one is
  asked for, built from the same approved row ("backfilled").
"""
import secrets
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.security import post_content_hash, resolve_platform_content
from app.models import (
    ApprovalAction, ApprovalCertificate, ApprovalLink, ApprovalLog, ApprovalReminder, Brand, JobStatus, Post,
    PostStatus, PublishJob, ReminderStage, SocialAccount, SocialPlatform, User, Workspace, WorkspaceMember,
)
from app.services.publishing.factory import get_adapter

# No 0/O, 1/I/L: read aloud or typed from paper without mistakes.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PUBLIC_ID_LENGTH = 12          # 31^12 ≈ 7.9e17 — not guessable at any rate limit

# Posts in these states have an approval their content still matches.
APPROVED_STATES = (PostStatus.APPROVED, PostStatus.SCHEDULED, PostStatus.PUBLISHING,
                   PostStatus.PUBLISHED, PostStatus.PARTIALLY_PUBLISHED, PostStatus.FAILED)


def new_public_id() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(PUBLIC_ID_LENGTH))


def display_id(public_id: str) -> str:
    """"K7Q2M9XD4TPA" → "K7Q2-M9XD-4TPA"."""
    return "-".join(public_id[i:i + 4] for i in range(0, len(public_id), 4))


def normalise_id(raw: str) -> str | None:
    """Accept what a person types: any case, with or without dashes/spaces."""
    cleaned = "".join(ch for ch in (raw or "").upper() if ch.isalnum())
    if len(cleaned) != PUBLIC_ID_LENGTH or any(ch not in _ALPHABET for ch in cleaned):
        return None
    return cleaned


async def platforms_for(db, post: Post, workspace_id: UUID) -> list[str]:
    """The platforms the post is meant for: every platform with an override,
    plus every platform the workspace has an active account on; all of them
    when neither tells us (the client approval page uses the same rule, D7)."""
    chosen = {k for k in (post.platform_targets or {}) if k in {p.value for p in SocialPlatform}}
    accounts = (await db.scalars(select(SocialAccount.platform).where(
        SocialAccount.workspace_id == workspace_id, SocialAccount.is_active.is_(True)))).all()
    chosen |= {p.value for p in accounts}
    order = [p.value for p in SocialPlatform]
    return [p for p in order if p in chosen] or order


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def _names(db, user_ids) -> dict:
    ids = {u for u in user_ids if u is not None}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all())


async def _trail(db, post: Post, up_to: datetime) -> list[dict]:
    """The post's approval history up to (and including) this approval."""
    logs = (await db.scalars(
        select(ApprovalLog).where(ApprovalLog.post_id == post.id, ApprovalLog.created_at <= up_to)
        .order_by(ApprovalLog.created_at)
    )).all()
    names = await _names(db, [log.user_id for log in logs])
    return [{
        "action": log.action.value,
        "by": log.actor_name if log.user_id is None else names.get(log.user_id, "A former member"),
        "via_link": log.approval_link_id is not None,
        "at": _iso(log.created_at),
        "note": log.rejection_reason,
        "due_at": _iso(log.due_at),
        "fingerprint": log.content_hash_at_action,
    } for log in logs]


async def issue(db, *, post: Post, brand: Brand, workspace: Workspace, approval: ApprovalLog,
                link: ApprovalLink | None = None, backfilled: bool = False) -> ApprovalCertificate:
    """Write the certificate for one `approved` row. Caller commits (and has
    flushed the row, so approval.id and created_at are set)."""
    submitted = await db.scalar(
        select(ApprovalLog)
        .where(ApprovalLog.post_id == post.id, ApprovalLog.action == ApprovalAction.SUBMITTED,
               ApprovalLog.created_at <= approval.created_at)
        .order_by(ApprovalLog.created_at.desc()).limit(1)
    )
    names = await _names(db, [approval.user_id, submitted.user_id if submitted else None,
                              link.created_by if link else None])
    if approval.user_id is not None:
        role = await db.scalar(select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.user_id == approval.user_id))
        approver = {"name": names.get(approval.user_id, "A former member"),
                    "kind": "manager", "role": role.value if role else None}
    else:
        approver = {"name": approval.actor_name or "Client", "kind": "client", "role": "client"}

    reminders = {"system": 0, "manual": 0}
    if submitted is not None:
        for stage, count in (await db.execute(
            select(ApprovalReminder.stage, func.count(ApprovalReminder.id))
            .where(ApprovalReminder.submission_log_id == submitted.id)
            .group_by(ApprovalReminder.stage)
        )).all():
            reminders["manual" if stage == ReminderStage.MANUAL_NUDGE else "system"] += count

    platforms = []
    for platform in await platforms_for(db, post, workspace.id):
        caption, hashtags, cta = resolve_platform_content(post, platform)
        platforms.append({"platform": platform,
                          "text": get_adapter(SocialPlatform(platform)).render_text(caption, hashtags, cta)})

    snapshot = {
        "title": post.title,
        "caption": post.caption,
        "hashtags": list(post.hashtags or []),
        "cta": post.cta,
        "platforms": platforms,
        "media": [{"storage_key": m.storage_key, "media_type": m.media_type.value, "order": i,
                   "alt_text": m.alt_text} for i, m in enumerate(post.media)],
        "brand_name": brand.name,
        "workspace_name": workspace.name,
        "submitted_by": names.get(submitted.user_id, "A former member") if submitted else None,
        "submitted_at": _iso(submitted.created_at) if submitted else None,
        "due_at": _iso(submitted.due_at) if submitted else None,
        "approver": approver,
        "assigned_name": approval.assigned_name,
        "acted_by_assignee": approval.acted_by_assignee,
        "link": None if link is None else {
            "recipient_name": link.recipient_name,
            "sent_by": names.get(link.created_by, "A former member"),
            "sent_at": _iso(link.created_at),
            "first_viewed_at": _iso(link.first_viewed_at),
            "decided_at": _iso(link.decided_at),
        },
        "reminders": reminders,
        "trail": await _trail(db, post, approval.created_at),
        "backfilled": backfilled,
    }
    certificate = ApprovalCertificate(
        public_id=new_public_id(), workspace_id=workspace.id, brand_id=brand.id, post_id=post.id,
        approval_log_id=approval.id, content_hash=approval.content_hash_at_action,
        version=post.version_number, approved_at=approval.created_at, snapshot=snapshot,
    )
    db.add(certificate)
    await db.flush()
    return certificate


async def latest_for_post(db, post: Post, brand: Brand, workspace: Workspace) -> ApprovalCertificate | None:
    """The post's newest certificate. A post approved before certificates
    existed gets one now, if its content still matches that approval."""
    found = await db.scalar(
        select(ApprovalCertificate).where(ApprovalCertificate.post_id == post.id)
        .order_by(ApprovalCertificate.approved_at.desc()).limit(1)
    )
    if found is not None or post.status not in APPROVED_STATES:
        return found
    approval = await db.scalar(
        select(ApprovalLog).where(ApprovalLog.post_id == post.id, ApprovalLog.action == ApprovalAction.APPROVED)
        .order_by(ApprovalLog.created_at.desc()).limit(1)
    )
    if approval is None or approval.content_hash_at_action != post_content_hash(post):
        return None
    link = await db.get(ApprovalLink, approval.approval_link_id) if approval.approval_link_id else None
    try:
        certificate = await issue(db, post=post, brand=brand, workspace=workspace, approval=approval,
                                  link=link, backfilled=True)
        await db.commit()
        return certificate
    except IntegrityError:  # two first views at once: the other one wrote it
        await db.rollback()
        return await db.scalar(select(ApprovalCertificate).where(
            ApprovalCertificate.approval_log_id == approval.id))


async def standing(db, certificate: ApprovalCertificate) -> dict:
    """What happened after the approval: current / superseded / post deleted,
    and the publish results that belong to this approval."""
    if certificate.post_id is None:
        return {"status": "post_deleted", "superseded_by": None, "published": []}
    post = await db.get(Post, certificate.post_id)
    newer = await db.scalar(
        select(ApprovalCertificate).where(ApprovalCertificate.post_id == certificate.post_id,
                                          ApprovalCertificate.approved_at > certificate.approved_at)
        .order_by(ApprovalCertificate.approved_at).limit(1)
    )
    if newer is not None or post is None or post.content_hash != certificate.content_hash \
            or post.status not in APPROVED_STATES:
        status = "superseded"
    else:
        status = "current"
    # Jobs created while this approval was the live one.
    jobs_q = (select(PublishJob, SocialAccount.platform, SocialAccount.account_name)
              .join(SocialAccount, SocialAccount.id == PublishJob.social_account_id)
              .where(PublishJob.post_id == certificate.post_id,
                     PublishJob.created_at >= certificate.approved_at)
              .order_by(PublishJob.created_at))
    if newer is not None:
        jobs_q = jobs_q.where(PublishJob.created_at < newer.approved_at)
    published = []
    for job, platform, account_name in (await db.execute(jobs_q)).all():
        if job.status == JobStatus.CANCELLED:
            continue
        result = job.result or {}
        published.append({
            "platform": platform.value, "account_name": account_name, "status": job.status.value,
            "url": result.get("url"),
            "published_at": result.get("published_at") or _iso(job.processed_at),
            # The worker refuses to publish unless the content matches the
            # latest approved fingerprint, so a completed job went out as approved.
            "matched_fingerprint": job.status == JobStatus.COMPLETED,
        })
    return {"status": status, "superseded_by": display_id(newer.public_id) if newer else None,
            "published": published}
