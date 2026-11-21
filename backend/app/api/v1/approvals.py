"""Approver picker, reassignment, saved client contacts, client approval
links (agency side) and in-app notifications.

Plan: docs/client_approval_link_plan.md §4.3. The public, no-login client
endpoints live in public_approval.py.
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    APPROVER_ROLES, client_ip, get_brand_access, get_current_user, get_post_access,
    get_post_membership, get_workspace_member,
)
from app.core.rate_limit import workspace_rate_limit
from app.db.session import get_db
from app.models import (
    ApprovalAction, ApprovalLink, ApprovalLog, AuditAction, Brand, BrandContact, Notification,
    NotificationType, Post, PostStatus, User, Workspace, WorkspaceMember,
)
from app.schemas.approvals import (
    ApprovalLinkCreate, ApprovalLinkResponse, ApproversResponse, BrandContactCreate,
    BrandContactResponse, BrandContactUpdate, ContactOption, LinkOptionsResponse, ManagerOption,
    NewLinkResponse, NotificationListResponse, NotificationResponse, ReviewerChoice,
    SubmitResponse, SuggestedReviewer, UnreadCountResponse,
)
from app.schemas.schemas import MessageResponse
from app.services import approvals as reviewers
from app.services.approval_links import (
    allowed_maximum, allowed_presets, create_link, expiry_bounds, link_status, utcnow,
    workspace_default,
)
from app.services.audit import record_audit_event
from app.services.features import enforce_limit, get_feature

router = APIRouter(tags=["Approvals"], dependencies=[Depends(workspace_rate_limit)])


# ── Helpers ────────────────────────────────────────────────────────────
def contact_schema(c: BrandContact) -> BrandContactResponse:
    return BrandContactResponse(
        id=c.id, brand_id=c.brand_id, name=c.name, role_label=c.role_label, phone=c.phone,
        email=c.email, is_active=c.is_active, forgotten=c.forgotten_at is not None, created_at=c.created_at,
    )


def link_schema(link: ApprovalLink, post: Post, now: datetime) -> ApprovalLinkResponse:
    state = link_status(link, post, now)
    return ApprovalLinkResponse(
        id=link.id, post_id=link.post_id, contact_id=link.contact_id, recipient_name=link.recipient_name,
        status=state, version_at_share=link.version_at_share, expiry_minutes=link.expiry_minutes,
        expires_at=link.expires_at, view_count=link.view_count, first_viewed_at=link.first_viewed_at,
        last_viewed_at=link.last_viewed_at, decided_at=link.decided_at, created_by=link.created_by,
        resent_from_id=link.resent_from_id, created_at=link.created_at,
        can_resend=state in ("expired", "revoked") and post.status == PostStatus.PENDING_APPROVAL
        and post.content_hash == link.content_hash_at_share,
    )


def require_manager(member: WorkspaceMember, detail: str) -> None:
    if member.role not in APPROVER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)


async def _post_context(post_id: UUID, db: AsyncSession, user: User):
    post = await get_post_access(post_id, db, user)
    member = await get_post_membership(post, db, user)
    brand = await db.get(Brand, post.brand_id)
    workspace = await db.get(Workspace, member.workspace_id)
    return post, member, brand, workspace


def _new_link_response(created, contact: Optional[BrandContact], phone: Optional[str] = None,
                       email: Optional[str] = None) -> NewLinkResponse:
    return NewLinkResponse(
        id=created.link.id, url=created.url, recipient_name=created.link.recipient_name,
        recipient_phone=contact.phone if contact else phone, recipient_email=contact.email if contact else email,
        expires_at=created.link.expires_at, expiry_minutes=created.link.expiry_minutes,
    )


def _split_contact(value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """A free-typed recipient contact is a phone or an email."""
    value = (value or "").strip()
    if not value:
        return None, None
    return (None, value) if "@" in value else (value, None)


# ── Approver picker & reassignment ─────────────────────────────────────
@router.get("/posts/{post_id}/approvers", response_model=ApproversResponse)
async def list_approvers(post_id: UUID, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """Who can be asked to review this post (D2), and who reviewed it last (D11)."""
    post, member, brand, workspace = await _post_context(post_id, db, user)
    excluded = None if workspace.allow_self_approval else post.created_by
    managers = await reviewers.manager_candidates(db, workspace, exclude_user_id=excluded)
    links_on = (await get_feature(db, workspace.id, "client_approval_links")).enabled
    contacts = await reviewers.contact_candidates(db, brand) if links_on else []

    suggested, note = None, None
    previous = await reviewers.previous_assignee(db, post)
    if previous.is_set:
        if previous.user_id and any(u.id == previous.user_id for u, _r in managers):
            suggested = SuggestedReviewer(kind="manager", id=previous.user_id, name=previous.name or "")
        elif previous.contact_id and any(c.id == previous.contact_id for c in contacts):
            suggested = SuggestedReviewer(kind="contact", id=previous.contact_id, name=previous.name or "")
        else:
            note = f"{previous.name or 'The previous reviewer'} can no longer approve posts here."
    return ApproversResponse(
        managers=[ManagerOption(user_id=u.id, name=u.full_name, role=r) for u, r in managers],
        contacts=[ContactOption(contact_id=c.id, name=c.name, role_label=c.role_label, phone=c.phone,
                                email=c.email) for c in contacts],
        suggested=suggested, suggestion_note=note,
        can_add_contacts=member.role in APPROVER_ROLES and links_on,
        client_links_enabled=links_on,
    )


@router.patch("/posts/{post_id}/assignee", response_model=SubmitResponse)
async def reassign(post_id: UUID, req: ReviewerChoice, request: Request,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Change who is asked to review a pending post. Writes a `reassigned`
    history row; earlier rows are never rewritten."""
    from app.api.v1.posts import can_manage, post_schema

    post, member, brand, workspace = await _post_context(post_id, db, user)
    if post.status != PostStatus.PENDING_APPROVAL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only posts waiting for approval can be reassigned.")
    if not can_manage(post, member):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only the author or a workspace admin can change the reviewer.")
    await db.execute(select(Post.id).where(Post.id == post.id).with_for_update())
    assignee, contact = await reviewers.resolve_requested_assignee(
        db, post=post, brand=brand, workspace=workspace,
        user_id=req.assign_to_user_id, contact_id=req.assign_to_contact_id,
    )
    previous = reviewers.current_assignee(post)
    if previous == assignee and contact is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That's already the reviewer.")

    reviewers.set_assignee(post, assignee)
    db.add(reviewers.snapshot(ApprovalLog(
        post_id=post.id, user_id=user.id, action=ApprovalAction.REASSIGNED,
        content_hash_at_action=post.content_hash,
        rejection_reason=f"Reassigned from {previous.name or reviewers.ANY_MANAGER} to "
                         f"{assignee.name or reviewers.ANY_MANAGER} by {user.full_name}.",
    ), assignee))
    record_audit_event(
        db, action=AuditAction.ASSIGN, entity_type="Post", entity_id=post.id, workspace_id=workspace.id,
        user_id=user.id, user_email=user.email, user_name=user.full_name, ip_address=client_ip(request),
        changes={"before": {"assigned_to": previous.name}, "after": {"assigned_to": assignee.name}},
    )
    new_link = None
    if contact is not None:
        created = await create_link(
            db, post=post, brand=brand, workspace=workspace, member=member, user=user, contact=contact,
            recipient_name=None, recipient_contact=None, expires_in_minutes=req.expires_in_minutes,
            ip_address=client_ip(request),
        )
        new_link = _new_link_response(created, contact)
    elif assignee.user_id:
        reviewers.notify(db, workspace_id=workspace.id, user_ids=[assignee.user_id],
                         type=NotificationType.ASSIGNED, post_id=post.id, actor_name=user.full_name,
                         exclude=user.id,
                         message=f"{user.full_name} asked you to approve {reviewers.post_label(post)}.")
    await db.commit()
    await db.refresh(post)
    return SubmitResponse(**post_schema(post).model_dump(), approval_link=new_link)


# ── Saved client contacts ──────────────────────────────────────────────
@router.get("/brands/{brand_id}/contacts", response_model=List[BrandContactResponse])
async def list_contacts(brand_id: UUID, include_removed: bool = Query(False),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    brand = await get_brand_access(brand_id, db, user)
    stmt = select(BrandContact).where(BrandContact.brand_id == brand.id)
    if not include_removed:
        stmt = stmt.where(BrandContact.is_active.is_(True))
    return [contact_schema(c) for c in (await db.scalars(stmt.order_by(BrandContact.name))).all()]


async def _brand_manager(brand_id: UUID, db: AsyncSession, user: User) -> tuple[Brand, WorkspaceMember]:
    brand = await get_brand_access(brand_id, db, user)
    member = await get_workspace_member(brand.workspace_id, db, user)
    require_manager(member, "Only owners and admins can manage client contacts.")
    return brand, member


@router.post("/brands/{brand_id}/contacts", response_model=BrandContactResponse,
             status_code=status.HTTP_201_CREATED)
async def create_contact(brand_id: UUID, req: BrandContactCreate, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    brand, _member = await _brand_manager(brand_id, db, user)
    if not brand.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This brand is deactivated.")

    async def contacts_on_brand() -> int:
        return await db.scalar(select(func.count(BrandContact.id)).where(
            BrandContact.brand_id == brand.id, BrandContact.is_active.is_(True))) or 0
    await enforce_limit(db, brand.workspace_id, "max_client_contacts_per_brand", contacts_on_brand,
                        message="Your plan's limit of client contacts for this brand is reached.")

    contact = BrandContact(brand_id=brand.id, workspace_id=brand.workspace_id, name=req.name,
                           role_label=(req.role_label or "").strip() or None, phone=req.phone,
                           email=str(req.email).lower() if req.email else None, created_by=user.id)
    db.add(contact)
    await db.flush()
    record_audit_event(
        db, action=AuditAction.CONTACT_CHANGE, entity_type="BrandContact", entity_id=contact.id,
        workspace_id=brand.workspace_id, user_id=user.id, user_email=user.email, user_name=user.full_name,
        changes={"after": {"name": contact.name, "brand_id": str(brand.id)}}, ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(contact)
    return contact_schema(contact)


async def _contact(brand: Brand, contact_id: UUID, db: AsyncSession) -> BrandContact:
    contact = await db.scalar(select(BrandContact).where(BrandContact.id == contact_id,
                                                         BrandContact.brand_id == brand.id).with_for_update())
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found.")
    return contact


@router.patch("/brands/{brand_id}/contacts/{contact_id}", response_model=BrandContactResponse)
async def update_contact(brand_id: UUID, contact_id: UUID, req: BrandContactUpdate, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    brand, _member = await _brand_manager(brand_id, db, user)
    contact = await _contact(brand, contact_id, db)
    if not contact.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This contact was removed.")
    changes = req.model_dump(exclude_unset=True)
    if "name" in changes and not (changes["name"] or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter the client's name.")
    for field, value in changes.items():
        if field == "email" and value is not None:
            value = str(value).lower()
        if field in ("name", "role_label") and isinstance(value, str):
            value = value.strip() or None
        setattr(contact, field, value)
    if not contact.phone and not contact.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a phone number or an email address.")
    record_audit_event(
        db, action=AuditAction.CONTACT_CHANGE, entity_type="BrandContact", entity_id=contact.id,
        workspace_id=brand.workspace_id, user_id=user.id, user_email=user.email, user_name=user.full_name,
        changes={"after": {k: ("(changed)" if k in ("phone", "email") else v) for k, v in changes.items()}},
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(contact)
    return contact_schema(contact)


@router.delete("/brands/{brand_id}/contacts/{contact_id}", response_model=MessageResponse)
async def remove_contact(brand_id: UUID, contact_id: UUID, request: Request,
                         forget: bool = Query(False, description="Also erase phone and email (DPDP)"),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Remove a contact: their open links stop working and their pending
    posts move to "any manager" (D12). The name stays in history."""
    brand, _member = await _brand_manager(brand_id, db, user)
    contact = await _contact(brand, contact_id, db)
    if not contact.is_active and (contact.forgotten_at or not forget):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This contact was already removed.")
    now = utcnow()
    contact.is_active = False
    if forget:
        contact.phone, contact.email, contact.role_label, contact.forgotten_at = None, None, None, now
    revoked = (await db.execute(
        update(ApprovalLink)
        .where(ApprovalLink.contact_id == contact.id, ApprovalLink.decided_at.is_(None),
               ApprovalLink.revoked_at.is_(None))
        .values(revoked_at=now, revoke_reason="contact_removed")
    )).rowcount
    # Free-typed recipient details on this contact's links are erased too.
    if forget:
        await db.execute(update(ApprovalLink).where(ApprovalLink.contact_id == contact.id)
                         .values(recipient_contact=None))
    released = await reviewers.release_contact_assignments(db, contact, reason="contact removed")
    record_audit_event(
        db, action=AuditAction.CONTACT_CHANGE, entity_type="BrandContact", entity_id=contact.id,
        workspace_id=brand.workspace_id, user_id=user.id, user_email=user.email, user_name=user.full_name,
        changes={"after": {"removed": True, "forgotten": forget, "links_revoked": revoked,
                           "posts_released": released}},
        ip_address=client_ip(request),
    )
    await db.commit()
    return MessageResponse(message="Contact removed." + (" Their phone and email were erased." if forget else ""))


# ── Links (agency side) ────────────────────────────────────────────────
@router.get("/workspaces/{workspace_id}/approval-link-options", response_model=LinkOptionsResponse)
async def link_options(workspace_id: UUID, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """The lifetimes this caller may pick in the Share dialog (D5)."""
    member = await get_workspace_member(workspace_id, db, user)
    workspace = await db.get(Workspace, workspace_id)
    bounds = await expiry_bounds(db)
    cap = allowed_maximum(bounds, workspace, member.role)
    return LinkOptionsResponse(
        presets=allowed_presets(bounds, cap), default_minutes=workspace_default(bounds, workspace),
        min_minutes=bounds.minimum, max_minutes=bounds.maximum, max_for_you=cap,
        workspace_default_minutes=workspace.approval_link_default_minutes,
    )


@router.post("/posts/{post_id}/approval-links", response_model=NewLinkResponse,
             status_code=status.HTTP_201_CREATED)
async def share_with_client(post_id: UUID, req: ApprovalLinkCreate, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Create a link for a pending post. The URL is in this response ONLY."""
    post, member, brand, workspace = await _post_context(post_id, db, user)
    contact = None
    if req.contact_id:
        contact = next((c for c in await reviewers.contact_candidates(db, brand) if c.id == req.contact_id), None)
        if contact is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That client contact isn't available for this brand.")
    created = await create_link(
        db, post=post, brand=brand, workspace=workspace, member=member, user=user, contact=contact,
        recipient_name=req.recipient_name, recipient_contact=req.recipient_contact,
        expires_in_minutes=req.expires_in_minutes, ip_address=client_ip(request),
    )
    phone, email = _split_contact(req.recipient_contact)
    response = _new_link_response(created, contact, phone, email)
    await db.commit()
    return response


@router.get("/posts/{post_id}/approval-links", response_model=List[ApprovalLinkResponse])
async def list_links(post_id: UUID, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    post = await get_post_access(post_id, db, user)
    links = (await db.scalars(select(ApprovalLink).where(ApprovalLink.post_id == post.id)
                              .order_by(ApprovalLink.created_at.desc()))).all()
    now = utcnow()
    return [link_schema(link, post, now) for link in links]


async def _link_for_manage(link_id: UUID, db: AsyncSession, user: User):
    link = await db.scalar(select(ApprovalLink).where(ApprovalLink.id == link_id).with_for_update())
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found.")
    post, member, brand, workspace = await _post_context(link.post_id, db, user)  # tenancy: 404 for outsiders
    return link, post, member, brand, workspace


@router.delete("/approval-links/{link_id}", response_model=MessageResponse)
async def revoke_link(link_id: UUID, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    link, post, member, _brand, workspace = await _link_for_manage(link_id, db, user)
    if link.created_by != user.id and member.role not in APPROVER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who shared it or an admin can revoke it.")
    if link.revoked_at is not None or link.decided_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is no longer active.")
    link.revoked_at, link.revoke_reason = utcnow(), "manual"
    record_audit_event(
        db, action=AuditAction.REVOKE_LINK, entity_type="Post", entity_id=post.id, workspace_id=workspace.id,
        user_id=user.id, user_email=user.email, user_name=user.full_name, ip_address=client_ip(request),
        changes={"after": {"link_id": str(link.id), "recipient": link.recipient_name}},
    )
    await db.commit()
    return MessageResponse(message="Link revoked. It no longer works.")


@router.post("/approval-links/{link_id}/resend", response_model=NewLinkResponse,
             status_code=status.HTTP_201_CREATED)
async def resend_link(link_id: UUID, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """A fresh link to the same recipient, same lifetime, for an expired or
    revoked one — only while the post is still pending with the same content."""
    link, post, member, brand, workspace = await _link_for_manage(link_id, db, user)
    state = link_status(link, post)
    if state not in ("expired", "revoked"):
        reasons = {"out_of_date": "This post changed or was reviewed since. Share it again instead.",
                   "approved": "The client already responded.", "changes_requested": "The client already responded."}
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reasons.get(state, "This link is still active."))
    contact = None
    if link.contact_id:
        contact = next((c for c in await reviewers.contact_candidates(db, brand) if c.id == link.contact_id), None)
        if contact is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That client contact was removed.")
    elif link.created_by != user.id and member.role not in APPROVER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Members can only resend to saved client contacts.")
    if link.revoked_at is None:
        link.revoked_at, link.revoke_reason = utcnow(), "resent"
    created = await create_link(
        db, post=post, brand=brand, workspace=workspace, member=member, user=user, contact=contact,
        recipient_name=link.recipient_name, recipient_contact=link.recipient_contact,
        expires_in_minutes=None, ip_address=client_ip(request), resent_from=link,
    )
    phone, email = _split_contact(link.recipient_contact)
    response = _new_link_response(created, contact, phone, email)
    await db.commit()
    return response


# ── Notifications ──────────────────────────────────────────────────────
def notification_schema(n: Notification) -> NotificationResponse:
    return NotificationResponse(id=n.id, type=n.type.value, post_id=n.post_id, actor_name=n.actor_name,
                                message=n.message, read_at=n.read_at, created_at=n.created_at)


async def _unread(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> int:
    return await db.scalar(select(func.count(Notification.id)).where(
        Notification.workspace_id == workspace_id, Notification.user_id == user_id,
        Notification.read_at.is_(None))) or 0


@router.get("/workspaces/{workspace_id}/notifications", response_model=NotificationListResponse)
async def list_notifications(workspace_id: UUID, unread_only: bool = Query(False, alias="unread"),
                             page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await get_workspace_member(workspace_id, db, user)
    stmt = select(Notification).where(Notification.workspace_id == workspace_id, Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = (await db.scalars(stmt.order_by(Notification.created_at.desc())
                             .offset((page - 1) * limit).limit(limit))).all()
    return NotificationListResponse(items=[notification_schema(n) for n in rows],
                                    unread=await _unread(db, workspace_id, user.id), page=page, limit=limit)


@router.get("/workspaces/{workspace_id}/notifications/unread-count", response_model=UnreadCountResponse)
async def unread_count(workspace_id: UUID, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    await get_workspace_member(workspace_id, db, user)
    return UnreadCountResponse(unread=await _unread(db, workspace_id, user.id))


@router.post("/workspaces/{workspace_id}/notifications/{notification_id}/read", response_model=UnreadCountResponse)
async def mark_read(workspace_id: UUID, notification_id: UUID, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    await get_workspace_member(workspace_id, db, user)
    result = await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.workspace_id == workspace_id,
               Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    if result.rowcount == 0:
        exists = await db.scalar(select(Notification.id).where(
            Notification.id == notification_id, Notification.workspace_id == workspace_id,
            Notification.user_id == user.id))
        if exists is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    await db.commit()
    return UnreadCountResponse(unread=await _unread(db, workspace_id, user.id))


@router.post("/workspaces/{workspace_id}/notifications/read-all", response_model=UnreadCountResponse)
async def mark_all_read(workspace_id: UUID, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    await get_workspace_member(workspace_id, db, user)
    await db.execute(update(Notification)
                     .where(Notification.workspace_id == workspace_id, Notification.user_id == user.id,
                            Notification.read_at.is_(None))
                     .values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return UnreadCountResponse(unread=0)
