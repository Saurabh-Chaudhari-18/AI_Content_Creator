"""Admin dashboard numbers."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_admin_db
from app.models import (
    AdminAlert, AlertStatus, JobStatus, OperationType, Plan, Post, PublishJob,
    UsageLog, User, Workspace, WorkspaceStatus,
)
from app.schemas.admin import AdminOverview

router = APIRouter()


@router.get("/overview", response_model=AdminOverview)
async def overview(db: AsyncSession = Depends(get_admin_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)

    async def count(stmt) -> int:
        return int(await db.scalar(stmt) or 0)

    by_plan = await db.execute(
        select(Plan.key, func.count(Workspace.id))
        .outerjoin(Workspace, Workspace.plan_id == Plan.id)
        .group_by(Plan.key)
    )
    return AdminOverview(
        workspaces_total=await count(select(func.count(Workspace.id))),
        workspaces_suspended=await count(
            select(func.count(Workspace.id)).where(Workspace.status == WorkspaceStatus.SUSPENDED)),
        workspaces_by_plan={key: n for key, n in by_plan.all()},
        users_total=await count(select(func.count(User.id))),
        users_active=await count(select(func.count(User.id)).where(User.is_active.is_(True))),
        users_signed_in_last_30_days=await count(
            select(func.count(User.id)).where(User.last_login_at >= since)),
        posts_total=await count(select(func.count(Post.id))),
        posts_created_last_30_days=await count(
            select(func.count(UsageLog.id)).where(
                UsageLog.operation == OperationType.POST_CREATED, UsageLog.created_at >= since)),
        posts_published_last_30_days=await count(
            select(func.count(UsageLog.id)).where(
                UsageLog.operation == OperationType.POST_PUBLISHED, UsageLog.created_at >= since)),
        jobs_failed=await count(select(func.count(PublishJob.id)).where(PublishJob.status == JobStatus.FAILED)),
        jobs_needing_review=await count(
            select(func.count(PublishJob.id)).where(PublishJob.status == JobStatus.NEEDS_REVIEW)),
        open_alerts=await count(
            select(func.count(AdminAlert.id)).where(AdminAlert.status != AlertStatus.RESOLVED)),
        database_role=await db.scalar(text("SELECT current_user")),
    )
