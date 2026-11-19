from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user, get_workspace_member
from app.core.rate_limit import workspace_rate_limit
from app.db.session import get_db
from app.models import Brand, Post, User
from app.schemas.schemas import CalendarPost
from app.api.v1.posts import media_schema

router = APIRouter(tags=["Calendar"], dependencies=[Depends(workspace_rate_limit)])

DEFAULT_WINDOW = timedelta(weeks=6)
MAX_WINDOW = timedelta(days=93)
MAX_POSTS = 1000  # far more than a calendar can show; a safety cap


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    """A date without a timezone is taken as UTC."""
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


@router.get("/workspaces/{workspace_id}/calendar", response_model=List[CalendarPost])
async def calendar(
    workspace_id: UUID,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    brand_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Tenancy comes from membership in the PATH workspace — the parameter
    # only selects which of the caller's workspaces to show.
    await get_workspace_member(workspace_id, db, user)

    stmt = (
        select(Post)
        .options(selectinload(Post.media))
        .join(Brand, Brand.id == Post.brand_id)
        .where(Brand.workspace_id == workspace_id)
    )
    if brand_id:
        stmt = stmt.where(Post.brand_id == brand_id)

    # Always a bounded window: without one this returned every post the
    # workspace ever had, with all its media (PERF-04). The web app asks for
    # the 6 weeks it shows; a missing side defaults to 6 weeks from the other.
    start_date, end_date = _utc(start_date), _utc(end_date)
    if start_date is None and end_date is None:
        start_date = datetime.now(timezone.utc) - DEFAULT_WINDOW / 2
    if start_date is None:
        start_date = end_date - DEFAULT_WINDOW
    if end_date is None:
        end_date = start_date + DEFAULT_WINDOW
    if end_date < start_date or end_date - start_date > MAX_WINDOW:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Ask for at most {MAX_WINDOW.days} days at a time, with start_date before end_date.")
    stmt = stmt.where(or_(
        Post.scheduled_at.between(start_date, end_date),
        Post.published_at.between(start_date, end_date),
    ))

    stmt = stmt.order_by(Post.scheduled_at.asc().nulls_last(), Post.created_at.desc())
    result = await db.execute(stmt.limit(MAX_POSTS))
    return [
        CalendarPost(
            id=p.id, title=p.title, caption=p.caption, status=p.status.value,
            scheduled_at=p.scheduled_at, published_at=p.published_at,
            brand_id=p.brand_id, media=[media_schema(m) for m in p.media],
        )
        for p in result.scalars().all()
    ]
