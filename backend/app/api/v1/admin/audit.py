"""Admin: the audit trail across the whole platform. Read-only — the admin
database role can add audit rows but never change or delete one."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.common import paging
from app.db.session import get_admin_db
from app.models import AuditAction, AuditEvent
from app.schemas.admin import AuditList, AuditRow

router = APIRouter()


@router.get("/audit", response_model=AuditList)
async def list_audit(
    workspace_id: UUID | None = Query(None),
    user_id: UUID | None = Query(None, description="who did it"),
    entity_id: UUID | None = Query(None),
    entity_type: str | None = Query(None, max_length=50),
    action: AuditAction | None = Query(None),
    staff_only: bool = Query(False, description="only actions taken by platform staff"),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    page_limit: tuple[int, int] = Depends(paging),
    db: AsyncSession = Depends(get_admin_db),
):
    page, limit = page_limit
    e = AuditEvent
    conditions = []
    if workspace_id:
        conditions.append(e.workspace_id == workspace_id)
    if user_id:
        conditions.append(e.user_id == user_id)
    if entity_id:
        conditions.append(e.entity_id == entity_id)
    if entity_type:
        conditions.append(e.entity_type == entity_type)
    if action:
        conditions.append(e.action == action)
    if staff_only:
        conditions.append(e.actor_platform_role.is_not(None))
    if since:
        conditions.append(e.created_at >= since)
    if until:
        conditions.append(e.created_at <= until)

    total = await db.scalar(select(func.count(e.id)).where(*conditions))
    rows = await db.execute(
        select(e).where(*conditions).order_by(e.created_at.desc(), e.id)
        .offset((page - 1) * limit).limit(limit)
    )
    return AuditList(
        items=[
            AuditRow(id=r.id, created_at=r.created_at, action=r.action.value, entity_type=r.entity_type,
                     entity_id=r.entity_id, workspace_id=r.workspace_id, user_id=r.user_id,
                     user_email=r.user_email, user_name=r.user_name,
                     actor_platform_role=r.actor_platform_role, reason=r.reason,
                     changes=r.changes or {}, ip_address=r.ip_address)
            for r in rows.scalars().all()
        ],
        total=total, page=page, limit=limit,
    )
