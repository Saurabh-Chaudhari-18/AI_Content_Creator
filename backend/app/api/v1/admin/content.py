"""Admin: a read-only look at customer content, and the usage report.

Nothing here can change a post, brand, media file or social account — the
admin database role has SELECT only on those tables. Opening a customer's
posts is itself recorded (action VIEW) in that customer's audit trail.
"""
import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.admin.common import admin_audit, like, not_found, paging, workspace_or_404
from app.api.v1.posts import post_schema
from app.core.dependencies import require_super_admin
from app.core.features import FEATURES
from app.db.session import get_admin_db
from app.models import (
    ApprovalLog, AuditAction, Brand, FeatureValueType, OperationType, Plan, Post, PostMedia,
    PostStatus, PublishJob, SocialAccount, UsageLog, User, Workspace, WorkspaceMember,
    WorkspaceStatus,
)
from app.schemas.admin import (
    AdminPostDetail, AdminPostList, AdminPostRow, AdminSocialAccount, UsageReport, UsageRow,
)
from app.schemas.schemas import ApprovalLogResponse, BrandResponse, JobResponse
from app.services.features import resolve_features_bulk

router = APIRouter()

_MB = 1024 * 1024
_LIMIT_KEYS = tuple(f.key for f in FEATURES if f.value_type == FeatureValueType.LIMIT)


# ── Posts, brands, social accounts ────────────────────────────────────
@router.get("/workspaces/{workspace_id}/posts", response_model=AdminPostList)
async def list_posts(
    workspace_id: UUID, request: Request,
    post_status: PostStatus | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=200),
    page_limit: tuple[int, int] = Depends(paging),
    db: AsyncSession = Depends(get_admin_db),
    admin: User = Depends(require_super_admin),
):
    page, limit = page_limit
    await workspace_or_404(db, workspace_id)
    media_count = (select(func.count(PostMedia.id)).where(PostMedia.post_id == Post.id)
                   .correlate(Post).scalar_subquery())
    stmt = (
        select(Post, Brand.name, User.email, media_count)
        .join(Brand, Brand.id == Post.brand_id)
        .join(User, User.id == Post.created_by)
        .where(Brand.workspace_id == workspace_id)
    )
    if post_status:
        stmt = stmt.where(Post.status == post_status)
    if search and search.strip():
        pattern = like(search)
        stmt = stmt.where(Post.caption.ilike(pattern) | Post.title.ilike(pattern))

    total = await db.scalar(select(func.count()).select_from(stmt.with_only_columns(Post.id).subquery()))
    rows = await db.execute(stmt.order_by(Post.created_at.desc()).offset((page - 1) * limit).limit(limit))
    items = [
        AdminPostRow(id=p.id, brand_id=p.brand_id, brand_name=brand_name, author_email=email, title=p.title,
                     caption=p.caption, status=p.status.value, media_count=n, scheduled_at=p.scheduled_at,
                     published_at=p.published_at, created_at=p.created_at)
        for p, brand_name, email, n in rows.all()
    ]
    admin_audit(db, admin, request, action=AuditAction.VIEW, entity_type="Workspace", entity_id=workspace_id,
                workspace_id=workspace_id, changes={"viewed": "posts", "page": page})
    await db.commit()
    return AdminPostList(items=items, total=total, page=page, limit=limit)


@router.get("/posts/{post_id}", response_model=AdminPostDetail)
async def get_post(post_id: UUID, request: Request,
                   db: AsyncSession = Depends(get_admin_db),
                   admin: User = Depends(require_super_admin)):
    """One post with its media, approval history and publish jobs."""
    row = (await db.execute(
        select(Post, Brand.workspace_id, Brand.name, User.email)
        .options(selectinload(Post.media))
        .join(Brand, Brand.id == Post.brand_id)
        .join(User, User.id == Post.created_by)
        .where(Post.id == post_id)
    )).one_or_none()
    if row is None:
        raise not_found("Post")
    post, workspace_id, brand_name, author_email = row
    history = await db.execute(
        select(ApprovalLog).where(ApprovalLog.post_id == post_id).order_by(ApprovalLog.created_at.desc()))
    jobs = await db.execute(
        select(PublishJob).where(PublishJob.post_id == post_id).order_by(PublishJob.created_at.asc()))
    detail = AdminPostDetail(
        workspace_id=workspace_id, brand_name=brand_name, author_email=author_email,
        post=post_schema(post),
        # D8: the super admin never sees who a client is — only that a client acted.
        history=[ApprovalLogResponse.model_validate(h).model_copy(update={
                     "actor_name": "Client (via link)" if h.approval_link_id else h.actor_name,
                     "assigned_name": "Client" if h.assigned_contact_id else h.assigned_name})
                 for h in history.scalars().all()],
        jobs=[JobResponse.model_validate(j) for j in jobs.scalars().all()],
    )
    admin_audit(db, admin, request, action=AuditAction.VIEW, entity_type="Post", entity_id=post_id,
                workspace_id=workspace_id, changes={"viewed": "post"})
    await db.commit()
    return detail


@router.get("/workspaces/{workspace_id}/brands", response_model=list[BrandResponse])
async def list_brands(workspace_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    await workspace_or_404(db, workspace_id)
    rows = await db.execute(
        select(Brand).where(Brand.workspace_id == workspace_id).order_by(Brand.created_at.desc()))
    return [BrandResponse.model_validate(b) for b in rows.scalars().all()]


@router.get("/workspaces/{workspace_id}/social-accounts", response_model=list[AdminSocialAccount])
async def list_social_accounts(workspace_id: UUID, db: AsyncSession = Depends(get_admin_db)):
    """Which accounts are connected and whether they are healthy. Tokens are
    not included: this API's database role cannot read them."""
    await workspace_or_404(db, workspace_id)
    a = SocialAccount
    rows = await db.execute(
        select(a.id, a.platform, a.account_name, a.account_type, a.platform_account_id, a.is_active,
               a.needs_reauth, a.token_expires_at, a.connected_at)
        .where(a.workspace_id == workspace_id).order_by(a.connected_at.desc())
    )
    return [
        AdminSocialAccount(id=r.id, platform=r.platform.value, account_name=r.account_name,
                           account_type=r.account_type, platform_account_id=r.platform_account_id,
                           is_active=r.is_active, needs_reauth=r.needs_reauth,
                           token_expires_at=r.token_expires_at, connected_at=r.connected_at)
        for r in rows.all()
    ]


# ── Usage report ──────────────────────────────────────────────────────
async def _usage_rows(db: AsyncSession, workspaces: list, days: int) -> list[UsageRow]:
    """Usage for the given (Workspace, plan_key) pairs.

    Two independent sources on purpose. The usage LOG is what limits are
    enforced against; the real TABLES are what actually exists. When they
    disagree, or a workspace is above a limit, a check is being bypassed —
    which is the thing this report exists to catch.
    """
    ids = [w.id for w, _ in workspaces]
    if not ids:
        return []
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    async def by_workspace(stmt) -> dict:
        return {ws_id: value for ws_id, value in (await db.execute(stmt)).all()}

    def logged(operation: OperationType, start: datetime):
        return (select(UsageLog.workspace_id, func.count(UsageLog.id))
                .where(UsageLog.workspace_id.in_(ids), UsageLog.operation == operation,
                       UsageLog.created_at >= start)
                .group_by(UsageLog.workspace_id))

    posts_created = await by_workspace(logged(OperationType.POST_CREATED, since))
    posts_published = await by_workspace(logged(OperationType.POST_PUBLISHED, since))
    posts_logged_month = await by_workspace(logged(OperationType.POST_CREATED, month_start))
    uploaded_bytes = await by_workspace(
        select(UsageLog.workspace_id, func.coalesce(func.sum(UsageLog.meta["bytes"].as_integer()), 0))
        .where(UsageLog.workspace_id.in_(ids), UsageLog.operation == OperationType.MEDIA_UPLOADED,
               UsageLog.created_at >= since)
        .group_by(UsageLog.workspace_id))
    brands = await by_workspace(
        select(Brand.workspace_id, func.count(Brand.id))
        .where(Brand.workspace_id.in_(ids), Brand.is_active.is_(True)).group_by(Brand.workspace_id))
    members = await by_workspace(
        select(WorkspaceMember.workspace_id, func.count(WorkspaceMember.id))
        .where(WorkspaceMember.workspace_id.in_(ids)).group_by(WorkspaceMember.workspace_id))
    social_accounts = await by_workspace(
        select(SocialAccount.workspace_id, func.count(SocialAccount.id))
        .where(SocialAccount.workspace_id.in_(ids), SocialAccount.is_active.is_(True))
        .group_by(SocialAccount.workspace_id))
    posts_table_month = await by_workspace(
        select(Brand.workspace_id, func.count(Post.id)).join(Brand, Brand.id == Post.brand_id)
        .where(Brand.workspace_id.in_(ids), Post.created_at >= month_start).group_by(Brand.workspace_id))
    stored_bytes = await by_workspace(
        select(Brand.workspace_id, func.coalesce(func.sum(PostMedia.meta["file_size"].as_integer()), 0))
        .join(Post, Post.id == PostMedia.post_id).join(Brand, Brand.id == Post.brand_id)
        .where(Brand.workspace_id.in_(ids)).group_by(Brand.workspace_id))
    limits = await resolve_features_bulk(db, ids, _LIMIT_KEYS)

    rows = []
    for workspace, plan_key in workspaces:
        ws = workspace.id
        stored_mb = int(stored_bytes.get(ws, 0)) / _MB
        used = {
            "max_brands": brands.get(ws, 0),
            "max_members": members.get(ws, 0),
            "max_social_accounts": social_accounts.get(ws, 0),
            # The larger of the two counts: a post missing from the log still counts.
            "max_posts_per_month": max(posts_logged_month.get(ws, 0), posts_table_month.get(ws, 0)),
            "max_storage_mb": stored_mb,
        }
        value = limits[ws]
        rows.append(UsageRow(
            workspace_id=ws, workspace_name=workspace.name, plan_key=plan_key, status=workspace.status.value,
            posts_created=posts_created.get(ws, 0), posts_published=posts_published.get(ws, 0),
            media_uploaded_mb=round(int(uploaded_bytes.get(ws, 0)) / _MB, 2),
            brands=used["max_brands"], members=used["max_members"],
            social_accounts=used["max_social_accounts"], media_stored_mb=round(stored_mb, 2),
            posts_logged_this_month=posts_logged_month.get(ws, 0),
            posts_in_table_this_month=posts_table_month.get(ws, 0),
            limits={key: (value[key].limit if value[key].enabled else 0) for key in _LIMIT_KEYS},
            over_limit=[
                key for key, amount in used.items()
                if amount > 0 and (not value[key].enabled
                                   or (value[key].limit is not None and amount > value[key].limit))
            ],
            usage_mismatch=posts_table_month.get(ws, 0) > posts_logged_month.get(ws, 0),
        ))
    return rows


def _csv(rows: list[UsageRow]) -> Response:
    out = io.StringIO()
    writer = csv.writer(out)
    columns = ["workspace_id", "workspace_name", "plan_key", "status", "posts_created", "posts_published",
               "media_uploaded_mb", "brands", "members", "social_accounts", "media_stored_mb",
               "posts_logged_this_month", "posts_in_table_this_month"]
    writer.writerow(columns + [f"limit_{key}" for key in _LIMIT_KEYS] + ["over_limit", "usage_mismatch"])
    for r in rows:
        writer.writerow(
            [getattr(r, c) for c in columns]
            + ["unlimited" if r.limits[key] is None else r.limits[key] for key in _LIMIT_KEYS]
            + [" ".join(r.over_limit), "yes" if r.usage_mismatch else "no"]
        )
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="usage.csv"'})


@router.get("/usage", response_model=UsageReport)
async def usage_report(
    days: int = Query(30, ge=1, le=365),
    plan: str | None = Query(None, max_length=50),
    workspace_status: WorkspaceStatus | None = Query(None, alias="status"),
    problems_only: bool = Query(False, description="only workspaces over a limit or with a usage mismatch"),
    export: str | None = Query(None, alias="format", pattern="^csv$", description="csv = download every row"),
    page_limit: tuple[int, int] = Depends(paging),
    db: AsyncSession = Depends(get_admin_db),
):
    """Usage per workspace, for billing and for catching a workspace that
    uses more than its plan allows."""
    page, limit = page_limit
    stmt = select(Workspace, Plan.key).join(Plan, Plan.id == Workspace.plan_id)
    if plan:
        stmt = stmt.where(Plan.key == plan)
    if workspace_status:
        stmt = stmt.where(Workspace.status == workspace_status)
    stmt = stmt.order_by(Workspace.created_at.desc())

    whole_report = problems_only or export == "csv"  # filtered or exported after computing
    workspaces = (await db.execute(stmt if whole_report else stmt.offset((page - 1) * limit).limit(limit))).all()
    rows = await _usage_rows(db, [(w, key) for w, key in workspaces], days)
    if problems_only:
        rows = [r for r in rows if r.over_limit or r.usage_mismatch]
    if export == "csv":
        return _csv(rows)
    if whole_report:
        total = len(rows)
        rows = rows[(page - 1) * limit: page * limit]
    else:
        total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    return UsageReport(days=days, items=rows, total=total, page=page, limit=limit)


@router.get("/workspaces/{workspace_id}/usage", response_model=UsageRow)
async def workspace_usage(workspace_id: UUID, days: int = Query(30, ge=1, le=365),
                          db: AsyncSession = Depends(get_admin_db)):
    workspace = await workspace_or_404(db, workspace_id)
    plan_key = await db.scalar(select(Plan.key).where(Plan.id == workspace.plan_id))
    return (await _usage_rows(db, [(workspace, plan_key)], days))[0]
