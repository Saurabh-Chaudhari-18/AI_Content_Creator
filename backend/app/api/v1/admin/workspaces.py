"""Admin: workspaces — list, create, plan, suspend, ownership, members,
and per-customer feature overrides.

Workspaces are never deleted here: deleting one removes its posts and
media, which is customer content. Suspend instead.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.common import (
    USER_COLUMNS, admin_audit, bad_request, like, not_found, paging, plan_by_key,
    reason_param, workspace_or_404,
)
from app.core.dependencies import require_super_admin
from app.core.features import FEATURES, FEATURES_BY_KEY
from app.db.session import get_admin_db
from app.models import (
    AuditAction, Brand, FeatureValueType, Plan, PlanFeature, Post, SocialAccount, User,
    Workspace, WorkspaceFeatureOverride, WorkspaceMember, WorkspaceRole, WorkspaceStatus,
)
from app.schemas.admin import (
    AdminMember, AdminMemberAdd, AdminMemberRole, AdminWorkspace, AdminWorkspaceCreate, ApprovalStats,
    AdminWorkspaceDetail, AdminWorkspaceFeature, AdminWorkspaceFeatures, AdminWorkspaceList,
    AdminWorkspaceUpdate, FeatureOverride, FeatureOverrideIn, Reasoned, TransferOwnership,
)
from app.schemas.schemas import MessageResponse
from app.services import accounts
from app.services.approval_stats import approval_stats
from app.services.features import resolve_features

router = APIRouter(prefix="/workspaces")

_MEMBER_COUNT = (
    select(func.count(WorkspaceMember.id))
    .where(WorkspaceMember.workspace_id == Workspace.id)
    .correlate(Workspace).scalar_subquery()
)
_ROWS = (
    select(Workspace, Plan.key, Plan.name, User.email, User.full_name, _MEMBER_COUNT)
    .join(Plan, Plan.id == Workspace.plan_id)
    .join(User, User.id == Workspace.owner_id)
)


def _schema(row) -> dict:
    workspace, plan_key, plan_name, owner_email, owner_name, member_count = row
    return dict(
        id=workspace.id, name=workspace.name, slug=workspace.slug, status=workspace.status.value,
        plan_key=plan_key, plan_name=plan_name, owner_id=workspace.owner_id,
        owner_email=owner_email, owner_name=owner_name, member_count=member_count,
        allow_self_approval=workspace.allow_self_approval, suspended_at=workspace.suspended_at,
        suspended_reason=workspace.suspended_reason, created_at=workspace.created_at,
    )


async def _detail(db: AsyncSession, workspace_id: UUID) -> AdminWorkspaceDetail:
    row = (await db.execute(_ROWS.where(Workspace.id == workspace_id))).one_or_none()
    if row is None:
        raise not_found("Workspace")

    async def count(stmt) -> int:
        return int(await db.scalar(stmt) or 0)

    return AdminWorkspaceDetail(
        **_schema(row),
        brand_count=await count(select(func.count(Brand.id)).where(
            Brand.workspace_id == workspace_id, Brand.is_active.is_(True))),
        post_count=await count(select(func.count(Post.id)).join(Brand, Brand.id == Post.brand_id).where(
            Brand.workspace_id == workspace_id)),
        social_account_count=await count(select(func.count(SocialAccount.id)).where(
            SocialAccount.workspace_id == workspace_id, SocialAccount.is_active.is_(True))),
        approvals=ApprovalStats(**await approval_stats(db, workspace_id)),
    )


# ── List, view, create, change ────────────────────────────────────────
@router.get("", response_model=AdminWorkspaceList)
async def list_workspaces(
    search: str | None = Query(None, max_length=200),
    plan: str | None = Query(None, max_length=50),
    workspace_status: WorkspaceStatus | None = Query(None, alias="status"),
    page_limit: tuple[int, int] = Depends(paging),
    db: AsyncSession = Depends(get_admin_db),
):
    page, limit = page_limit
    stmt = _ROWS
    if search and search.strip():
        pattern = like(search)
        stmt = stmt.where(or_(Workspace.name.ilike(pattern), Workspace.slug.ilike(pattern),
                              User.email.ilike(pattern)))
    if plan:
        stmt = stmt.where(Plan.key == plan)
    if workspace_status:
        stmt = stmt.where(Workspace.status == workspace_status)

    total = await db.scalar(select(func.count()).select_from(stmt.with_only_columns(Workspace.id).subquery()))
    rows = await db.execute(stmt.order_by(Workspace.created_at.desc()).offset((page - 1) * limit).limit(limit))
    return AdminWorkspaceList(items=[AdminWorkspace(**_schema(r)) for r in rows.all()],
                              total=total, page=page, limit=limit)


@router.post("", response_model=AdminWorkspaceDetail, status_code=status.HTTP_201_CREATED)
async def create_workspace(req: AdminWorkspaceCreate, request: Request,
                           db: AsyncSession = Depends(get_admin_db),
                           admin: User = Depends(require_super_admin)):
    """A new workspace owned by an existing login. To create the login too,
    use POST /admin/users with `new_workspace_name`."""
    owner = (await db.execute(select(*USER_COLUMNS).where(User.email == req.owner_email.lower()))).one_or_none()
    if owner is None:
        raise bad_request("No login has that email. Create the login first.")
    if not owner.is_active:
        raise bad_request("That login is deactivated.")
    plan = await plan_by_key(db, req.plan_key, assignable=True) if req.plan_key else None

    workspace = await accounts.create_workspace(db, owner_id=owner.id, name=req.name,
                                                plan_id=plan.id if plan else None)
    admin_audit(db, admin, request, action=AuditAction.CREATE, entity_type="Workspace",
                entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                changes={"after": {"name": workspace.name, "owner_email": owner.email,
                                   "plan": plan.key if plan else "default"}})
    await db.commit()
    return await _detail(db, workspace.id)


@router.get("/{workspace_id}", response_model=AdminWorkspaceDetail)
async def get_workspace(workspace_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    return await _detail(db, workspace_id)


@router.patch("/{workspace_id}", response_model=AdminWorkspaceDetail)
async def update_workspace(workspace_id: UUID, req: AdminWorkspaceUpdate, request: Request,
                           db: AsyncSession = Depends(get_admin_db),
                           admin: User = Depends(require_super_admin)):
    """Rename a workspace or move it to another plan. A plan change applies
    to the customer's next request."""
    workspace = await workspace_or_404(db, workspace_id, lock=True)

    if req.name is not None and req.name.strip() != workspace.name:
        before, workspace.name = workspace.name, req.name.strip()
        admin_audit(db, admin, request, action=AuditAction.UPDATE, entity_type="Workspace",
                    entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                    changes={"before": {"name": before}, "after": {"name": workspace.name}})
    if req.plan_key is not None:
        plan = await plan_by_key(db, req.plan_key, assignable=True)
        if plan.id != workspace.plan_id:
            old_key = await db.scalar(select(Plan.key).where(Plan.id == workspace.plan_id))
            workspace.plan_id = plan.id
            admin_audit(db, admin, request, action=AuditAction.PLAN_CHANGE, entity_type="Workspace",
                        entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                        changes={"before": {"plan": old_key}, "after": {"plan": plan.key}})
    await db.commit()
    return await _detail(db, workspace_id)


# ── Suspend / reactivate ──────────────────────────────────────────────
@router.post("/{workspace_id}/suspend", response_model=AdminWorkspaceDetail)
async def suspend_workspace(workspace_id: UUID, req: Reasoned, request: Request,
                            db: AsyncSession = Depends(get_admin_db),
                            admin: User = Depends(require_super_admin)):
    """Make a workspace read-only: its members can still sign in and look,
    nothing can be created, changed or published — queued posts fail
    instead of going out. Nothing is deleted."""
    workspace = await workspace_or_404(db, workspace_id, lock=True)
    if workspace.status == WorkspaceStatus.SUSPENDED:
        raise bad_request("This workspace is already suspended.")
    workspace.status = WorkspaceStatus.SUSPENDED
    workspace.suspended_at = datetime.now(timezone.utc)
    workspace.suspended_reason = req.reason
    admin_audit(db, admin, request, action=AuditAction.SUSPEND, entity_type="Workspace",
                entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason)
    await db.commit()
    return await _detail(db, workspace_id)


@router.post("/{workspace_id}/reactivate", response_model=AdminWorkspaceDetail)
async def reactivate_workspace(workspace_id: UUID, req: Reasoned, request: Request,
                               db: AsyncSession = Depends(get_admin_db),
                               admin: User = Depends(require_super_admin)):
    workspace = await workspace_or_404(db, workspace_id, lock=True)
    if workspace.status != WorkspaceStatus.SUSPENDED:
        raise bad_request("This workspace is not suspended.")
    was = workspace.suspended_reason
    workspace.status = WorkspaceStatus.ACTIVE
    workspace.suspended_at = None
    workspace.suspended_reason = None
    admin_audit(db, admin, request, action=AuditAction.REACTIVATE, entity_type="Workspace",
                entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                changes={"before": {"suspended_reason": was}})
    await db.commit()
    return await _detail(db, workspace_id)


# ── Ownership and members ─────────────────────────────────────────────
async def _member(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = await db.scalar(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id))
    if member is None:
        raise not_found("Member")
    return member


@router.post("/{workspace_id}/transfer-ownership", response_model=AdminWorkspaceDetail)
async def transfer_ownership(workspace_id: UUID, req: TransferOwnership, request: Request,
                             db: AsyncSession = Depends(get_admin_db),
                             admin: User = Depends(require_super_admin)):
    """Make another member the owner. The previous owner stays, as an admin."""
    workspace = await workspace_or_404(db, workspace_id, lock=True)
    if req.new_owner_user_id == workspace.owner_id:
        raise bad_request("That user already owns this workspace.")
    new_owner = await _member(db, workspace_id, req.new_owner_user_id)  # must already be a member
    if not await db.scalar(select(User.is_active).where(User.id == req.new_owner_user_id)):
        raise bad_request("That login is deactivated.")
    old_owner_id = workspace.owner_id
    old_owner = await _member(db, workspace_id, old_owner_id)

    old_owner.role = WorkspaceRole.ADMIN
    await db.flush()
    new_owner.role = WorkspaceRole.OWNER
    workspace.owner_id = req.new_owner_user_id
    admin_audit(db, admin, request, action=AuditAction.OWNERSHIP_TRANSFER, entity_type="Workspace",
                entity_id=workspace.id, workspace_id=workspace.id, reason=req.reason,
                changes={"before": {"owner_id": str(old_owner_id)},
                         "after": {"owner_id": str(req.new_owner_user_id)}})
    await db.commit()
    return await _detail(db, workspace_id)


@router.get("/{workspace_id}/members", response_model=list[AdminMember])
async def list_members(workspace_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    await workspace_or_404(db, workspace_id)
    rows = await db.execute(
        select(User.id, User.email, User.full_name, User.is_active,
               WorkspaceMember.role, WorkspaceMember.joined_at)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.joined_at.asc())
    )
    return [AdminMember(user_id=r.id, email=r.email, full_name=r.full_name, is_active=r.is_active,
                        role=r.role.value, joined_at=r.joined_at) for r in rows.all()]


@router.post("/{workspace_id}/members", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def add_member(workspace_id: UUID, req: AdminMemberAdd, request: Request,
                     db: AsyncSession = Depends(get_admin_db),
                     admin: User = Depends(require_super_admin)):
    """Add an existing login to a workspace, within the plan's member limit
    (raise the limit with a feature override first if needed). The
    customer's own approval setting is left as it is."""
    await workspace_or_404(db, workspace_id)
    if req.role == WorkspaceRole.OWNER:
        raise bad_request("A workspace has one owner. Use transfer-ownership instead.")
    target = (await db.execute(select(*USER_COLUMNS).where(User.email == req.email.lower()))).one_or_none()
    if target is None:
        raise bad_request("No login has that email. Create the login first.")
    if await db.scalar(select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target.id)):
        raise bad_request("That user is already a member of this workspace.")

    await accounts.add_member(db, workspace_id=workspace_id, user_id=target.id, role=req.role,
                              enable_review_on_second_member=False)
    admin_audit(db, admin, request, action=AuditAction.INVITE, entity_type="WorkspaceMember",
                entity_id=target.id, workspace_id=workspace_id, reason=req.reason,
                changes={"after": {"member_email": target.email, "role": req.role.value}})
    await db.commit()
    return MessageResponse(message=f"Added {target.full_name} to the workspace.")


@router.patch("/{workspace_id}/members/{user_id}", response_model=MessageResponse)
async def change_member_role(workspace_id: UUID, user_id: UUID, req: AdminMemberRole, request: Request,
                             db: AsyncSession = Depends(get_admin_db),
                             admin: User = Depends(require_super_admin)):
    member = await _member(db, workspace_id, user_id)
    if member.role == WorkspaceRole.OWNER or req.role == WorkspaceRole.OWNER:
        raise bad_request("The owner changes only through transfer-ownership.")
    if member.role != req.role:
        before, member.role = member.role, req.role
        admin_audit(db, admin, request, action=AuditAction.ROLE_CHANGE, entity_type="WorkspaceMember",
                    entity_id=user_id, workspace_id=workspace_id, reason=req.reason,
                    changes={"before": {"role": before.value}, "after": {"role": req.role.value}})
        await db.commit()
    return MessageResponse(message=f"Role is now {req.role.value}.")


@router.delete("/{workspace_id}/members/{user_id}", response_model=MessageResponse)
async def remove_member(workspace_id: UUID, user_id: UUID, request: Request,
                        reason: str = Depends(reason_param),
                        db: AsyncSession = Depends(get_admin_db),
                        admin: User = Depends(require_super_admin)):
    """Remove a member. Their posts stay in the workspace."""
    member = await _member(db, workspace_id, user_id)
    if member.role == WorkspaceRole.OWNER:
        raise bad_request("The owner cannot be removed. Transfer ownership first.")
    await db.execute(delete(WorkspaceMember).where(WorkspaceMember.id == member.id))
    admin_audit(db, admin, request, action=AuditAction.DELETE, entity_type="WorkspaceMember",
                entity_id=user_id, workspace_id=workspace_id, reason=reason,
                changes={"before": {"role": member.role.value}})
    await db.commit()
    return MessageResponse(message="Member removed.")


# ── Features: what this customer gets, and per-customer overrides ─────
def _check_feature_value(key: str, limit: int | None) -> None:
    definition = FEATURES_BY_KEY.get(key)
    if definition is None:
        raise not_found("Feature")
    if definition.value_type == FeatureValueType.BOOLEAN and limit is not None:
        raise bad_request(f"'{definition.name}' is an on/off feature and takes no limit.")


@router.get("/{workspace_id}/features", response_model=AdminWorkspaceFeatures)
async def workspace_features(workspace_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    workspace = await workspace_or_404(db, workspace_id)
    plan_key = await db.scalar(select(Plan.key).where(Plan.id == workspace.plan_id))
    resolved = await resolve_features(db, workspace_id)
    plan_values = {pf.feature_key: pf for pf in (await db.execute(
        select(PlanFeature).where(PlanFeature.plan_id == workspace.plan_id))).scalars()}
    overrides = {o.feature_key: o for o in (await db.execute(
        select(WorkspaceFeatureOverride).where(WorkspaceFeatureOverride.workspace_id == workspace_id))).scalars()}
    now = datetime.now(timezone.utc)

    items = []
    for f in FEATURES:
        plan_value, override, value = plan_values.get(f.key), overrides.get(f.key), resolved[f.key]
        items.append(AdminWorkspaceFeature(
            key=f.key, name=f.name, category=f.category, value_type=f.value_type.value,
            enabled=value.enabled, limit=value.limit, source=value.source,
            plan_enabled=bool(plan_value and plan_value.enabled),
            plan_limit=plan_value.limit_value if plan_value else None,
            override=FeatureOverride(
                enabled=override.enabled, limit=override.limit_value, expires_at=override.expires_at,
                expired=override.expires_at is not None and override.expires_at <= now,
                reason=override.reason, set_by_user_id=override.set_by_user_id, updated_at=override.updated_at,
            ) if override else None,
        ))
    return AdminWorkspaceFeatures(workspace_id=workspace_id, plan_key=plan_key, features=items)


@router.put("/{workspace_id}/features/{key}", response_model=AdminWorkspaceFeatures)
async def set_feature_override(workspace_id: UUID, key: str, req: FeatureOverrideIn, request: Request,
                               db: AsyncSession = Depends(get_admin_db),
                               admin: User = Depends(require_super_admin)):
    """Give this one customer something different from their plan: a feature
    on or off, or their own limit (null = unlimited). `expires_at` makes it
    a trial that ends by itself. Applies to the customer's next request."""
    await workspace_or_404(db, workspace_id)
    _check_feature_value(key, req.limit)
    if req.expires_at is not None and req.expires_at <= datetime.now(timezone.utc):
        raise bad_request("expires_at must be in the future.")

    override = await db.scalar(select(WorkspaceFeatureOverride).where(
        WorkspaceFeatureOverride.workspace_id == workspace_id, WorkspaceFeatureOverride.feature_key == key))
    before = None
    if override is None:
        override = WorkspaceFeatureOverride(workspace_id=workspace_id, feature_key=key)
        db.add(override)
    else:
        before = {"enabled": override.enabled, "limit": override.limit_value,
                  "expires_at": override.expires_at.isoformat() if override.expires_at else None}
    override.enabled = req.enabled
    override.limit_value = req.limit
    override.expires_at = req.expires_at
    override.reason = req.reason
    override.set_by_user_id = admin.id
    admin_audit(db, admin, request, action=AuditAction.FEATURE_CHANGE, entity_type="Workspace",
                entity_id=workspace_id, workspace_id=workspace_id, reason=req.reason,
                changes={"feature": key, "before": before,
                         "after": {"enabled": req.enabled, "limit": req.limit,
                                   "expires_at": req.expires_at.isoformat() if req.expires_at else None}})
    await db.commit()
    return await workspace_features(workspace_id, db)


@router.delete("/{workspace_id}/features/{key}", response_model=AdminWorkspaceFeatures)
async def remove_feature_override(workspace_id: UUID, key: str, request: Request,
                                  reason: str = Depends(reason_param),
                                  db: AsyncSession = Depends(get_admin_db),
                                  admin: User = Depends(require_super_admin)):
    """Back to the plan default for this feature."""
    await workspace_or_404(db, workspace_id)
    override = await db.scalar(select(WorkspaceFeatureOverride).where(
        WorkspaceFeatureOverride.workspace_id == workspace_id, WorkspaceFeatureOverride.feature_key == key))
    if override is None:
        raise not_found("Override")
    await db.execute(delete(WorkspaceFeatureOverride).where(WorkspaceFeatureOverride.id == override.id))
    admin_audit(db, admin, request, action=AuditAction.FEATURE_CHANGE, entity_type="Workspace",
                entity_id=workspace_id, workspace_id=workspace_id, reason=reason,
                changes={"feature": key, "after": None,
                         "before": {"enabled": override.enabled, "limit": override.limit_value}})
    await db.commit()
    return await workspace_features(workspace_id, db)
