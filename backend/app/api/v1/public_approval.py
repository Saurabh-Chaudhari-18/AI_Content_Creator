"""Public, no-login client approval endpoints (the page at /a#<token>).

The token arrives in the POST body — the page reads it from the URL
fragment, which browsers never send to a server. No cookies, no CSRF
surface. Every response is `no-store`, `no-referrer`, `noindex`.

Plan: docs/client_approval_link_plan.md §4.4.
"""
import logging

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.core.dependencies import client_ip
from app.core.rate_limit import public_link_rate_limit, record_invalid_token
from app.db.session import get_db
from app.models import (
    ApprovalAction, ApprovalLinkDecision, ApprovalLog, AuditAction, NotificationType, PostStatus,
    SocialAccount, SocialPlatform,
)
from app.core.security import resolve_platform_content
from app.schemas.approvals import (
    PublicDecideRequest, PublicMedia, PublicPlatformPreview, PublicReceipt, PublicTokenRequest,
    PublicViewResponse,
)
from app.services import approvals as reviewers
from app.services.approval_links import LinkProblem, check_usable, resolve_public_link, utcnow
from app.services.audit import record_audit_event
from app.services.publishing.factory import get_adapter
from app.services.storage import get_storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/public/approval", tags=["Public approval"])

_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"}


def _problem(exc: LinkProblem) -> JSONResponse:
    return JSONResponse(status_code=exc.http_status, content={"detail": exc.detail, "code": exc.code},
                        headers=_HEADERS)


def _receipt(link, version_hash: str) -> PublicReceipt | None:
    if link.decision is None:
        return None
    return PublicReceipt(decision=link.decision.value, name=link.recipient_name, decided_at=link.decided_at,
                         version=link.version_at_share, fingerprint=version_hash[:12])


async def _platforms(db, post, workspace_id) -> list[str]:
    """The platforms the client should see (D7): every platform with an
    override, plus every platform the workspace has an active account on;
    all three when neither tells us."""
    chosen = {k for k in (post.platform_targets or {}) if k in {p.value for p in SocialPlatform}}
    accounts = (await db.scalars(select(SocialAccount.platform).where(
        SocialAccount.workspace_id == workspace_id, SocialAccount.is_active.is_(True)))).all()
    chosen |= {p.value for p in accounts}
    order = [p.value for p in SocialPlatform]
    return [p for p in order if p in chosen] or order


@router.post("/view", response_model=PublicViewResponse)
async def view(req: PublicTokenRequest, request: Request, response: Response, db=Depends(get_db),
               _limit=Depends(public_link_rate_limit)):
    try:
        link, post, brand, workspace = await resolve_public_link(db, req.token)
    except LinkProblem as exc:
        if exc.code == "not_valid":
            await record_invalid_token(client_ip(request))
        return _problem(exc)

    now = utcnow()
    state, message = "open", None
    try:
        await check_usable(db, link, post, now)
    except LinkProblem as exc:
        state, message = exc.code, exc.detail

    # Count the view (best effort: a failure here must not hide the page).
    link.view_count = (link.view_count or 0) + 1
    link.first_viewed_at = link.first_viewed_at or now
    link.last_viewed_at = now
    await db.commit()

    for key, value in _HEADERS.items():
        response.headers[key] = value
    body = PublicViewResponse(
        state=state, message=message, agency_name=workspace.name, brand_name=brand.name,
        brand_logo_url=brand.logo_url, recipient_name=link.recipient_name, version=link.version_at_share,
        expires_at=link.expires_at, server_now=now, receipt=_receipt(link, link.content_hash_at_share),
    )
    # The content itself only while the link can still be acted on, or to
    # remind the client what THEY decided. Never after someone else decided
    # or the post changed: that is not what this link was shared for.
    if state in ("open", "already_decided", "expired"):
        storage = get_storage()
        body.media = [PublicMedia(url=storage.display_url(m.storage_key), media_type=m.media_type.value,
                                  alt_text=m.alt_text) for m in post.media]
        for platform in await _platforms(db, post, workspace.id):
            caption, hashtags, cta = resolve_platform_content(post, platform)
            text = get_adapter(SocialPlatform(platform)).render_text(caption, hashtags, cta)
            body.platforms.append(PublicPlatformPreview(platform=platform, text=text, character_count=len(text)))
    return body


@router.post("/decide", response_model=PublicReceipt)
async def decide(req: PublicDecideRequest, request: Request, response: Response, db=Depends(get_db),
                 _limit=Depends(public_link_rate_limit)):
    """Approve or request changes. First decision wins (D9); the deadline is
    checked here, on the server's clock, at the moment of deciding (D5)."""
    from app.core.rate_limit import public_decide_rate_limit

    ip = client_ip(request)
    try:
        await public_decide_rate_limit(db, req.token)
        # Locks the link AND the post: a double tap or a manager deciding at
        # the same moment cannot both succeed.
        link, post, brand, workspace = await resolve_public_link(db, req.token, lock=True)
        await check_usable(db, link, post, utcnow())
    except LinkProblem as exc:
        if exc.code == "not_valid":
            await record_invalid_token(ip)
        return _problem(exc)

    now = utcnow()
    approve = req.decision == "approve"
    assignee = reviewers.current_assignee(post)
    by_assignee = reviewers.acted_by_assignee(assignee, contact_id=link.contact_id)
    client = req.name.strip()[:120]   # what the client typed: kept on the history row
    link.decision = ApprovalLinkDecision.APPROVED if approve else ApprovalLinkDecision.CHANGES_REQUESTED
    link.decided_at = now

    post.status = PostStatus.APPROVED if approve else PostStatus.DRAFT
    reviewers.clear_assignee(post)
    log = reviewers.snapshot(ApprovalLog(
        post_id=post.id, user_id=None, approval_link_id=link.id, actor_name=client,
        action=ApprovalAction.APPROVED if approve else ApprovalAction.REJECTED,
        content_hash_at_action=post.content_hash,
        rejection_reason=(req.note or "").strip() or None,
    ), assignee)
    log.acted_by_assignee = by_assignee
    db.add(log)
    record_audit_event(
        db, action=AuditAction.APPROVE if approve else AuditAction.REJECT, entity_type="Post",
        entity_id=post.id, workspace_id=workspace.id, user_id=None, user_email="",
        user_name=f"{client} (client, via link)", ip_address=ip,
        user_agent=(request.headers.get("user-agent") or "")[:500],
        changes={"after": {"via": "client link", "link_id": str(link.id), "version": link.version_at_share,
                           "assigned_to": assignee.name, "acted_by_assignee": by_assignee,
                           "note": (req.note or "")[:200] or None}},
    )
    label = reviewers.post_label(post)
    reviewers.notify(
        db, workspace_id=workspace.id, user_ids=[post.created_by, link.created_by, assignee.user_id],
        type=NotificationType.CLIENT_APPROVED if approve else NotificationType.CLIENT_CHANGES_REQUESTED,
        post_id=post.id, actor_name=f"{client} (client)",
        message=f"{client} approved {label}." if approve else f"{client} requested changes to {label}.",
    )
    await db.commit()
    for key, value in _HEADERS.items():
        response.headers[key] = value
    return _receipt(link, link.content_hash_at_share)
