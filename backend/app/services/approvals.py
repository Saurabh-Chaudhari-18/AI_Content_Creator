"""Who reviews a post: the approver picker, assignment, fall-back and the
in-app notifications that go with them.

Rules (docs/client_approval_link_plan.md, D2-D4, D9-D12):
- A post is ASSIGNED to one manager (owner/admin) or one saved client
  contact, or to nobody ("any manager"). Assignment routes the request; it
  never restricts who may decide — any manager can approve while pending.
- Every assignment change is an append-only `reassigned` history row, and
  every decision row records who it was assigned to and whether the
  assignee acted, so "approved by Amit on Priya's behalf" is permanent.
- When the assignee can no longer approve, the post falls back to "any
  manager" (synchronously here for customer actions; the Beat sweep in
  workers/tasks/approvals.py covers admin-panel actions, whose database
  role cannot write customer content).
"""
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select

from app.core.dependencies import APPROVER_ROLES
from app.models import (
    ApprovalAction, ApprovalLog, Brand, BrandContact, Notification, NotificationType, Post,
    PostStatus, User, Workspace, WorkspaceMember,
)

ANY_MANAGER = "any manager"


@dataclass(frozen=True)
class Assignee:
    user_id: UUID | None = None
    contact_id: UUID | None = None
    name: str | None = None

    @property
    def is_set(self) -> bool:
        return self.user_id is not None or self.contact_id is not None


def post_label(post: Post) -> str:
    text = (post.title or post.caption or "Untitled post").strip().replace("\n", " ")
    return f"“{text[:60]}{'…' if len(text) > 60 else ''}”"


def current_assignee(post: Post) -> Assignee:
    return Assignee(post.assigned_approver_id, post.assigned_contact_id, post.assigned_name)


def set_assignee(post: Post, assignee: Assignee) -> None:
    post.assigned_approver_id = assignee.user_id
    post.assigned_contact_id = assignee.contact_id
    post.assigned_name = assignee.name if assignee.is_set else None


def clear_assignee(post: Post) -> None:
    set_assignee(post, Assignee())


def snapshot(log: ApprovalLog, assignee: Assignee) -> ApprovalLog:
    """Copy the assignee onto a history row (in place) and return it."""
    log.assigned_user_id = assignee.user_id
    log.assigned_contact_id = assignee.contact_id
    log.assigned_name = assignee.name
    return log


def acted_by_assignee(assignee: Assignee, *, user_id: UUID | None = None,
                      contact_id: UUID | None = None) -> bool | None:
    """None when nobody was assigned; else whether the actor IS the assignee."""
    if not assignee.is_set:
        return None
    if user_id is not None:
        return assignee.user_id == user_id
    return contact_id is not None and assignee.contact_id == contact_id


# ── Candidates ─────────────────────────────────────────────────────────
async def manager_candidates(db, workspace: Workspace, *, exclude_user_id: UUID | None) -> list[tuple[User, str]]:
    """Active users with an approver role in the workspace: [(user, role)]."""
    rows = (await db.execute(
        select(User, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace.id,
               WorkspaceMember.role.in_(APPROVER_ROLES),
               User.is_active.is_(True))
        .order_by(User.full_name)
    )).all()
    return [(u, r.value) for u, r in rows if u.id != exclude_user_id]


async def contact_candidates(db, brand: Brand) -> list[BrandContact]:
    if not brand.is_active:
        return []
    return list((await db.scalars(
        select(BrandContact)
        .where(BrandContact.brand_id == brand.id, BrandContact.is_active.is_(True),
               BrandContact.forgotten_at.is_(None))
        .order_by(BrandContact.name)
    )).all())


def _self_excluded(workspace: Workspace, author_id: UUID) -> UUID | None:
    return None if workspace.allow_self_approval else author_id


async def resolve_requested_assignee(
    db, *, post: Post, brand: Brand, workspace: Workspace,
    user_id: UUID | None, contact_id: UUID | None,
) -> tuple[Assignee, BrandContact | None]:
    """Validate a requested assignee. 400 with a plain reason if invalid."""
    if user_id and contact_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick one reviewer: a manager or a client, not both.")
    if user_id:
        managers = await manager_candidates(db, workspace, exclude_user_id=_self_excluded(workspace, post.created_by))
        match = next((u for u, _r in managers if u.id == user_id), None)
        if match is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "That person can't approve posts in this workspace.")
        return Assignee(user_id=match.id, name=match.full_name), None
    if contact_id:
        contact = next((c for c in await contact_candidates(db, brand) if c.id == contact_id), None)
        if contact is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "That client contact isn't available for this brand.")
        return Assignee(contact_id=contact.id, name=contact.name), contact
    return Assignee(), None


async def still_valid(db, assignee: Assignee, *, post: Post, brand: Brand, workspace: Workspace) -> bool:
    if assignee.user_id:
        managers = await manager_candidates(db, workspace, exclude_user_id=_self_excluded(workspace, post.created_by))
        return any(u.id == assignee.user_id for u, _r in managers)
    if assignee.contact_id:
        return any(c.id == assignee.contact_id for c in await contact_candidates(db, brand))
    return False


async def previous_assignee(db, post: Post) -> Assignee:
    """The reviewer of the latest submission or person-made reassignment
    (D11). A system fall-back row is skipped, so the picker can explain that
    the previous reviewer can no longer approve."""
    log = await db.scalar(
        select(ApprovalLog)
        .where(ApprovalLog.post_id == post.id,
               ApprovalLog.action.in_((ApprovalAction.SUBMITTED, ApprovalAction.REASSIGNED)),
               ApprovalLog.user_id.is_not(None))
        .order_by(ApprovalLog.created_at.desc()).limit(1)
    )
    if log is None:
        return Assignee()
    return Assignee(log.assigned_user_id, log.assigned_contact_id, log.assigned_name)


# ── Notifications ──────────────────────────────────────────────────────
def notify(db, *, workspace_id: UUID, user_ids, type: NotificationType, message: str,
           post_id: UUID | None = None, actor_name: str | None = None,
           exclude: UUID | None = None) -> None:
    """Queue one bell entry per distinct recipient (works on sync and async
    sessions: it only calls add)."""
    for uid in {u for u in user_ids if u is not None and u != exclude}:
        db.add(Notification(workspace_id=workspace_id, user_id=uid, type=type, post_id=post_id,
                            actor_name=actor_name, message=message[:300]))


# ── Fall-back (D12) ────────────────────────────────────────────────────
async def release_contact_assignments(db, contact: BrandContact, *, reason: str) -> int:
    """Pending posts assigned to this contact move to "any manager"."""
    posts = (await db.scalars(
        select(Post).where(Post.assigned_contact_id == contact.id,
                           Post.status == PostStatus.PENDING_APPROVAL)
        .with_for_update()
    )).all()
    for post in posts:
        release_one(db, post, workspace_id=contact.workspace_id, reason=reason)
    return len(posts)


def release_one(db, post: Post, *, workspace_id: UUID, reason: str, overdue: bool = False) -> None:
    """Shared by the API (async) and the Beat sweeps (sync): only add()s.
    `overdue`: the reviewer didn't answer by the deadline (brand setting),
    rather than losing the right to approve."""
    previous = current_assignee(post)
    who = previous.name or "The reviewer"
    clear_assignee(post)
    if overdue:
        history = f"{who} didn't answer by the deadline. Moved to {ANY_MANAGER}."
        message = f"{who} didn't answer {post_label(post)} by the deadline. It's now open to {ANY_MANAGER}."
    else:
        history = f"{who} can no longer approve ({reason}). Moved to {ANY_MANAGER}."
        message = f"{who} can no longer approve {post_label(post)}. It's now open to {ANY_MANAGER}."
    db.add(snapshot(ApprovalLog(
        post_id=post.id, user_id=None, actor_name="System",
        action=ApprovalAction.REASSIGNED, content_hash_at_action=post.content_hash,
        rejection_reason=history,
    ), Assignee()))
    notify(db, workspace_id=workspace_id, user_ids=[post.created_by],
           type=NotificationType.ASSIGNMENT_RELEASED, post_id=post.id, message=message)
