"""Admin: logins — list, create, deactivate, setup links, force logout,
platform staff.

The admin never sets, sees or resets a password. A new login starts with no
usable password and gets a one-time "set your password" link, which the
admin passes on; a forgotten password is replaced the same way. The
database enforces it: the admin role cannot read or write password_hash
after the row is created.
"""
import uuid as uuid_mod
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.common import (
    USER_COLUMNS, admin_audit, bad_request, like, paging, plan_by_key, user_or_404, workspace_or_404,
)
from app.core.dependencies import require_super_admin
from app.db.session import get_admin_db
from app.models import (
    AuditAction, RefreshToken, SetupTokenPurpose, User, UserSetupToken,
    Workspace, WorkspaceMember, WorkspaceRole,
)
from app.schemas.admin import (
    AdminMembership, AdminSession, AdminUser, AdminUserCreate, AdminUserDetail, AdminUserList,
    AdminUserUpdate, ForceLogoutResponse, PendingSetupLink, PlatformRoleIn, Reasoned,
    SetupLinkResponse,
)
from app.services import accounts

router = APIRouter(prefix="/users")

_WORKSPACE_COUNT = (
    select(func.count(WorkspaceMember.id))
    .where(WorkspaceMember.user_id == User.id)
    .correlate(User).scalar_subquery()
)


def _user(row, workspace_count: int = 0) -> dict:
    return dict(
        id=row.id, email=row.email, full_name=row.full_name, is_active=row.is_active,
        platform_role=row.platform_role.value if row.platform_role else None,
        last_login_at=row.last_login_at, created_at=row.created_at, workspace_count=workspace_count,
    )


async def _end_sessions(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.is_revoked.is_(False))
        .values(is_revoked=True)
    )
    return result.rowcount


@router.get("", response_model=AdminUserList)
async def list_users(
    search: str | None = Query(None, max_length=200),
    staff: bool | None = Query(None, description="true = platform staff only, false = customers only"),
    active: bool | None = Query(None),
    page_limit: tuple[int, int] = Depends(paging),
    db: AsyncSession = Depends(get_admin_db),
):
    page, limit = page_limit
    conditions = []
    if search and search.strip():
        pattern = like(search)
        conditions.append(or_(User.email.ilike(pattern), User.full_name.ilike(pattern)))
    if staff is not None:
        conditions.append(User.platform_role.is_not(None) if staff else User.platform_role.is_(None))
    if active is not None:
        conditions.append(User.is_active.is_(active))

    total = await db.scalar(select(func.count(User.id)).where(*conditions))
    rows = await db.execute(
        select(*USER_COLUMNS, _WORKSPACE_COUNT.label("workspace_count")).where(*conditions)
        .order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )
    return AdminUserList(items=[AdminUser(**_user(r, r.workspace_count)) for r in rows.all()],
                         total=total, page=page, limit=limit)


@router.post("", response_model=SetupLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_user(req: AdminUserCreate, request: Request,
                      db: AsyncSession = Depends(get_admin_db),
                      admin: User = Depends(require_super_admin)):
    """Create a login and return its one-time setup link. Optionally put it
    in an existing workspace (`workspace_id` + `role`) or give it a new
    workspace of its own (`new_workspace_name`)."""
    email = req.email.lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise bad_request("A login with this email already exists.")
    if req.workspace_id is not None:
        await workspace_or_404(db, req.workspace_id)
        if req.role == WorkspaceRole.OWNER:
            raise bad_request("A workspace has one owner. Add the login, then use transfer-ownership.")
    plan = await plan_by_key(db, req.plan_key, assignable=True) if req.plan_key else None

    user_id = uuid_mod.uuid4()
    await db.execute(insert(User).values(
        id=user_id, email=email, full_name=req.full_name,
        password_hash=accounts.UNUSABLE_PASSWORD, is_active=True,
    ))
    admin_audit(db, admin, request, action=AuditAction.CREATE, entity_type="User", entity_id=user_id,
                reason=req.reason, changes={"after": {"email": email, "full_name": req.full_name}})

    workspace_id = req.workspace_id
    if req.new_workspace_name is not None:
        workspace = await accounts.create_workspace(db, owner_id=user_id, name=req.new_workspace_name,
                                                    plan_id=plan.id if plan else None)
        workspace_id = workspace.id
        admin_audit(db, admin, request, action=AuditAction.CREATE, entity_type="Workspace",
                    entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                    changes={"after": {"name": workspace.name, "owner_email": email}})
    elif req.workspace_id is not None:
        await accounts.add_member(db, workspace_id=req.workspace_id, user_id=user_id, role=req.role,
                                  enable_review_on_second_member=False)
        admin_audit(db, admin, request, action=AuditAction.INVITE, entity_type="WorkspaceMember",
                    entity_id=user_id, workspace_id=req.workspace_id, reason=req.reason,
                    changes={"after": {"member_email": email, "role": req.role.value}})

    link, expires_at = await accounts.issue_setup_link(
        db, user_id=user_id, purpose=SetupTokenPurpose.ACCOUNT_SETUP, created_by_user_id=admin.id)
    admin_audit(db, admin, request, action=AuditAction.SETUP_LINK, entity_type="User", entity_id=user_id,
                reason=req.reason, changes={"after": {"purpose": "account_setup",
                                                      "expires_at": expires_at.isoformat()}})
    await db.commit()
    return SetupLinkResponse(user_id=user_id, email=email, setup_link=link,
                             expires_at=expires_at, workspace_id=workspace_id)


@router.get("/{user_id}", response_model=AdminUserDetail)
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    row = await user_or_404(db, user_id)
    now = datetime.now(timezone.utc)
    memberships = await db.execute(
        select(Workspace.id, Workspace.name, Workspace.status, WorkspaceMember.role)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user_id).order_by(WorkspaceMember.joined_at.asc())
    )
    sessions = await db.execute(
        select(RefreshToken.id, RefreshToken.ip_address, RefreshToken.user_agent,
               RefreshToken.created_at, RefreshToken.expires_at)
        .where(RefreshToken.user_id == user_id, RefreshToken.is_revoked.is_(False),
               RefreshToken.expires_at > now)
        .order_by(RefreshToken.created_at.desc())
    )
    link = (await db.execute(
        select(UserSetupToken.purpose, UserSetupToken.expires_at, UserSetupToken.created_at)
        .where(UserSetupToken.user_id == user_id, UserSetupToken.used_at.is_(None),
               UserSetupToken.expires_at > now)
        .order_by(UserSetupToken.created_at.desc()).limit(1)
    )).one_or_none()
    membership_rows = memberships.all()
    return AdminUserDetail(
        **_user(row, len(membership_rows)),
        memberships=[AdminMembership(workspace_id=m.id, workspace_name=m.name,
                                     workspace_status=m.status.value, role=m.role.value)
                     for m in membership_rows],
        sessions=[AdminSession(id=s.id, ip_address=s.ip_address, user_agent=s.user_agent,
                               created_at=s.created_at, expires_at=s.expires_at) for s in sessions.all()],
        pending_setup_link=PendingSetupLink(purpose=link.purpose.value, expires_at=link.expires_at,
                                            created_at=link.created_at) if link else None,
    )


@router.patch("/{user_id}", response_model=AdminUserDetail)
async def update_user(user_id: UUID, req: AdminUserUpdate, request: Request,
                      db: AsyncSession = Depends(get_admin_db),
                      admin: User = Depends(require_super_admin)):
    """Rename a login, or deactivate / reactivate it. A deactivated login is
    refused on its very next request and all its sessions are ended."""
    row = await user_or_404(db, user_id)
    values, before, after = {}, {}, {}
    if req.full_name is not None and req.full_name.strip() != row.full_name:
        values["full_name"] = req.full_name.strip()
        before["full_name"], after["full_name"] = row.full_name, values["full_name"]
    if req.is_active is not None and req.is_active != row.is_active:
        if user_id == admin.id:
            raise bad_request("You cannot deactivate your own login.")
        values["is_active"] = req.is_active
        before["is_active"], after["is_active"] = row.is_active, req.is_active
    if values:
        await db.execute(update(User).where(User.id == user_id).values(**values, updated_at=func.now()))
        if values.get("is_active") is False:
            after["sessions_ended"] = await _end_sessions(db, user_id)
        admin_audit(db, admin, request, action=AuditAction.UPDATE, entity_type="User", entity_id=user_id,
                    reason=req.reason, changes={"before": before, "after": after})
        await db.commit()
    return await get_user(user_id, db)


@router.post("/{user_id}/setup-link", response_model=SetupLinkResponse)
async def new_setup_link(user_id: UUID, req: Reasoned, request: Request,
                         db: AsyncSession = Depends(get_admin_db),
                         admin: User = Depends(require_super_admin)):
    """A fresh one-time "set your password" link — for a login that never
    finished setup, or one that forgot its password. Any earlier unused
    link stops working."""
    row = await user_or_404(db, user_id)
    if not row.is_active:
        raise bad_request("This login is deactivated. Reactivate it first.")
    purpose = (SetupTokenPurpose.ACCOUNT_SETUP if row.last_login_at is None
               else SetupTokenPurpose.PASSWORD_RESET)
    link, expires_at = await accounts.issue_setup_link(
        db, user_id=user_id, purpose=purpose, created_by_user_id=admin.id)
    admin_audit(db, admin, request, action=AuditAction.SETUP_LINK, entity_type="User", entity_id=user_id,
                reason=req.reason, changes={"after": {"purpose": purpose.value,
                                                      "expires_at": expires_at.isoformat()}})
    await db.commit()
    return SetupLinkResponse(user_id=user_id, email=row.email, setup_link=link, expires_at=expires_at)


@router.post("/{user_id}/force-logout", response_model=ForceLogoutResponse)
async def force_logout(user_id: UUID, req: Reasoned, request: Request,
                       db: AsyncSession = Depends(get_admin_db),
                       admin: User = Depends(require_super_admin)):
    """End every session of a login. Each device is signed out when its
    current access token runs out (within ACCESS_TOKEN_EXPIRE_MINUTES); to
    cut access off at once, deactivate the login instead."""
    await user_or_404(db, user_id)
    ended = await _end_sessions(db, user_id)
    admin_audit(db, admin, request, action=AuditAction.FORCE_LOGOUT, entity_type="User", entity_id=user_id,
                reason=req.reason, changes={"after": {"sessions_ended": ended}})
    await db.commit()
    return ForceLogoutResponse(sessions_ended=ended)


@router.put("/{user_id}/platform-role", response_model=AdminUserDetail)
async def set_platform_role(user_id: UUID, req: PlatformRoleIn, request: Request,
                            db: AsyncSession = Depends(get_admin_db),
                            admin: User = Depends(require_super_admin)):
    """Make a login platform staff, or an ordinary customer login again.
    You cannot change your own role, so there is always one super admin
    left; the first one is created from the command line."""
    row = await user_or_404(db, user_id)
    if user_id == admin.id:
        raise bad_request("You cannot change your own platform role.")
    if req.platform_role is not None and not row.is_active:
        raise bad_request("This login is deactivated.")
    if row.platform_role != req.platform_role:
        await db.execute(update(User).where(User.id == user_id)
                         .values(platform_role=req.platform_role, updated_at=func.now()))
        admin_audit(db, admin, request, action=AuditAction.ROLE_CHANGE, entity_type="User", entity_id=user_id,
                    reason=req.reason,
                    changes={"before": {"platform_role": row.platform_role.value if row.platform_role else None},
                             "after": {"platform_role": req.platform_role.value if req.platform_role else None}})
        await db.commit()
    return await get_user(user_id, db)
