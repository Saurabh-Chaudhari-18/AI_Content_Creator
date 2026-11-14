"""Client approval links: tokens, lifetimes, state and creation.

Security model (docs/client_approval_link_plan.md §4.4, §8):
- 32 random bytes per token; only its SHA-256 is stored; the raw token is
  returned once, at creation. The URL carries it after `#`, which browsers
  never send to a server, so it cannot land in access logs or Referer.
- A link is bound to the content hash and version it was shared for, and
  works only while that post is still pending with exactly that content.
- Lifetime has three levels (D5): the platform range (super admin), the
  workspace default (owner/admin), and the sender's choice. Members may only
  shorten the workspace default.
"""
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.dependencies import APPROVER_ROLES
from app.core.security import post_content_hash
from app.models import (
    ApprovalAction, ApprovalLink, ApprovalLog, AuditAction, Brand, BrandContact, Post, PostStatus,
    User, Workspace, WorkspaceMember, WorkspaceStatus,
)
from app.services.audit import record_audit_event
from app.services.features import enforce_limit, get_feature, require_feature
from app.services.platform_settings import get_setting

# Offered lifetimes, in minutes: 15 min, 1 h, 24 h, 3 d, 7 d, 14 d, 30 d.
PRESET_MINUTES = (15, 60, 1440, 4320, 10080, 20160, 43200)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def link_url(raw_token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/a#{raw_token}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Lifetimes ──────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ExpiryBounds:
    minimum: int
    maximum: int
    platform_default: int


async def expiry_bounds(db) -> ExpiryBounds:
    """The platform range, kept consistent even if the three settings were
    saved in a contradictory order (min > max is read as min = max)."""
    lo = await get_setting(db, "approval_link_min_expiry_minutes")
    hi = await get_setting(db, "approval_link_max_expiry_minutes")
    default = await get_setting(db, "approval_link_default_minutes")
    lo = min(lo, hi)
    return ExpiryBounds(lo, hi, max(lo, min(default, hi)))


def workspace_default(bounds: ExpiryBounds, workspace: Workspace) -> int:
    value = workspace.approval_link_default_minutes or bounds.platform_default
    return max(bounds.minimum, min(value, bounds.maximum))


def allowed_maximum(bounds: ExpiryBounds, workspace: Workspace, role) -> int:
    """Owners/admins: the platform max. Members: the workspace default."""
    return bounds.maximum if role in APPROVER_ROLES else workspace_default(bounds, workspace)


def allowed_presets(bounds: ExpiryBounds, cap: int) -> list[int]:
    presets = [m for m in PRESET_MINUTES if bounds.minimum <= m <= cap]
    return presets or [cap]


def choose_minutes(bounds: ExpiryBounds, workspace: Workspace, role, requested: int | None) -> int:
    if requested is None:
        return workspace_default(bounds, workspace)
    if requested < bounds.minimum or requested > bounds.maximum:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A link must last between {describe_minutes(bounds.minimum)} and {describe_minutes(bounds.maximum)}.",
        )
    cap = allowed_maximum(bounds, workspace, role)
    if requested > cap:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Members can share links for up to {describe_minutes(cap)} (the workspace default). "
            "Ask an owner or admin for a longer link.",
        )
    return requested


def describe_minutes(minutes: int) -> str:
    if minutes % 1440 == 0:
        days = minutes // 1440
        return f"{days} day{'s' if days != 1 else ''}"
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{minutes} minutes"


# ── State ──────────────────────────────────────────────────────────────
def link_status(link: ApprovalLink, post: Post, now: datetime | None = None) -> str:
    """What the agency's link list shows."""
    now = now or utcnow()
    if link.decision is not None:
        return link.decision.value                 # approved | changes_requested
    if link.revoked_at is not None:
        return "revoked"
    if post.status != PostStatus.PENDING_APPROVAL or post.content_hash != link.content_hash_at_share:
        return "out_of_date"
    if link.expires_at <= now:
        return "expired"
    return "opened" if link.view_count else "not_opened"


async def open_links_count(db, workspace_id: UUID) -> int:
    now = utcnow()
    return await db.scalar(
        select(func.count(ApprovalLink.id))
        .join(Post, Post.id == ApprovalLink.post_id)
        .where(ApprovalLink.workspace_id == workspace_id,
               ApprovalLink.decided_at.is_(None), ApprovalLink.revoked_at.is_(None),
               ApprovalLink.expires_at > now, Post.status == PostStatus.PENDING_APPROVAL)
    ) or 0


# ── Creation ───────────────────────────────────────────────────────────
@dataclass
class CreatedLink:
    link: ApprovalLink
    url: str


async def create_link(
    db, *, post: Post, brand: Brand, workspace: Workspace, member: WorkspaceMember, user: User,
    contact: BrandContact | None, recipient_name: str | None, recipient_contact: str | None,
    expires_in_minutes: int | None, ip_address: str | None, resent_from: ApprovalLink | None = None,
) -> CreatedLink:
    """Create one link for a pending post. Caller commits."""
    await require_feature(db, workspace.id, "client_approval_links")
    if post.status != PostStatus.PENDING_APPROVAL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Only posts waiting for approval can be shared with a client. Submit it first.")
    if not brand.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This brand is deactivated.")
    if contact is None:
        # D4: a free-typed recipient could be anyone — owners/admins only.
        if member.role not in APPROVER_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Members can only share with the brand's saved client contacts.")
        if not (recipient_name or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter the client's name.")
        name, reach = recipient_name.strip()[:120], (recipient_contact or "").strip()[:255] or None
    else:
        name, reach = contact.name, None

    await enforce_limit(db, workspace.id, "max_open_approval_links", lambda: open_links_count(db, workspace.id),
                        message="You've reached your plan's limit of open client links. "
                                "Revoke or wait for some to be decided first.")

    bounds = await expiry_bounds(db)
    minutes = resent_from.expiry_minutes if resent_from is not None else \
        choose_minutes(bounds, workspace, member.role, expires_in_minutes)
    if resent_from is not None:  # the range may have narrowed since
        minutes = max(bounds.minimum, min(minutes, bounds.maximum))

    raw = new_token()
    now = utcnow()
    link = ApprovalLink(
        post_id=post.id, workspace_id=workspace.id, contact_id=contact.id if contact else None,
        token_hash=hash_token(raw), content_hash_at_share=post.content_hash,
        version_at_share=post.version_number, recipient_name=name, recipient_contact=reach,
        created_by=user.id, expiry_minutes=minutes, expires_at=now + timedelta(minutes=minutes),
        resent_from_id=resent_from.id if resent_from else None, view_count=0,
    )
    db.add(link)
    await db.flush()
    record_audit_event(
        db, action=AuditAction.SHARE_LINK, entity_type="Post", entity_id=post.id,
        workspace_id=workspace.id, user_id=user.id, user_email=user.email, user_name=user.full_name,
        changes={"after": {"link_id": str(link.id), "recipient": name, "saved_contact": contact is not None,
                           "expiry_minutes": minutes, "resent_from": str(resent_from.id) if resent_from else None}},
        ip_address=ip_address,
    )
    return CreatedLink(link=link, url=link_url(raw))


# ── Public resolution ──────────────────────────────────────────────────
class LinkProblem(Exception):
    """Why a public link can't be used. `code` is stable for the page."""

    def __init__(self, code: str, http_status: int, detail: str, link: ApprovalLink | None = None):
        super().__init__(detail)
        self.code, self.http_status, self.detail, self.link = code, http_status, detail, link


NOT_VALID = "This link is not valid. Ask the agency for a new one."


async def resolve_public_link(db, raw_token: str, *, lock: bool = False):
    """Find the link and check everything except expiry-at-decision, which
    the caller re-checks with the same clock it decides on.

    Unknown, revoked, brand-deactivated and feature-off links all answer the
    same 404 — a guesser learns nothing (D13, §4.4)."""
    if not raw_token or len(raw_token) > 200:
        raise LinkProblem("not_valid", 404, NOT_VALID)
    stmt = select(ApprovalLink).where(ApprovalLink.token_hash == hash_token(raw_token))
    if lock:
        stmt = stmt.with_for_update()
    link = await db.scalar(stmt)
    if link is None or link.revoked_at is not None:
        raise LinkProblem("not_valid", 404, NOT_VALID)
    post_stmt = select(Post).options(selectinload(Post.media)).where(Post.id == link.post_id)
    if lock:
        post_stmt = post_stmt.with_for_update()
    post = await db.scalar(post_stmt)
    brand = await db.get(Brand, post.brand_id) if post else None
    workspace = await db.get(Workspace, link.workspace_id)
    if post is None or brand is None or workspace is None or not brand.is_active:
        raise LinkProblem("not_valid", 404, NOT_VALID)
    if not (await get_feature(db, workspace.id, "client_approval_links")).enabled \
            or workspace.status == WorkspaceStatus.SUSPENDED:
        raise LinkProblem("unavailable", 409, "This page is temporarily unavailable. Please try again later.")
    return link, post, brand, workspace


async def check_usable(db, link: ApprovalLink, post: Post, now: datetime) -> None:
    """The decision-time checks, shared by view (for its state) and decide."""
    if link.decision is not None:
        raise LinkProblem("already_decided", 409, "You've already responded to this post.", link)
    if post.status != PostStatus.PENDING_APPROVAL:
        # Somebody decided (D9: first decision wins) — or the agency pulled
        # the post back to edit it. Never name the other reviewer.
        decided = await db.scalar(
            select(func.count(ApprovalLog.id)).where(
                ApprovalLog.post_id == post.id,
                ApprovalLog.action.in_((ApprovalAction.APPROVED, ApprovalAction.REJECTED)),
                ApprovalLog.created_at >= link.created_at,
            )
        )
        if decided:
            raise LinkProblem("already_reviewed", 409, "This post has already been reviewed.", link)
        raise LinkProblem("changed", 409,
                          "The agency is updating this post. Ask them for the new link.", link)
    live = post_content_hash(post)
    if link.content_hash_at_share != live or post.content_hash != live:
        raise LinkProblem("changed", 409,
                          "This post has changed since it was shared with you. Ask the agency for the new link.",
                          link)
    if link.expires_at <= now:
        raise LinkProblem("expired", 410, "This link has expired. Ask the agency for a new one.", link)
