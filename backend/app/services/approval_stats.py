"""Counts for the super admin panel (§7): adoption and the client-approval
funnel. Runs on the admin database role, so it selects only columns that
role may read — never tokens, recipient details or contact names."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select

from app.models import (
    ApprovalAction, ApprovalLink, ApprovalLinkDecision, ApprovalLog, Brand, BrandContact, Post,
)

WINDOW_DAYS = 30


async def approval_stats(db, workspace_id: UUID | None = None) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=WINDOW_DAYS)

    def scoped(stmt, column):
        return stmt.where(column == workspace_id) if workspace_id else stmt

    links = select(
        func.count(ApprovalLink.id),
        func.count(ApprovalLink.first_viewed_at),
        func.count(ApprovalLink.id).filter(ApprovalLink.decision == ApprovalLinkDecision.APPROVED),
        func.count(ApprovalLink.id).filter(ApprovalLink.decision == ApprovalLinkDecision.CHANGES_REQUESTED),
        func.count(ApprovalLink.id).filter(ApprovalLink.decided_at.is_(None), ApprovalLink.revoked_at.is_(None),
                                           ApprovalLink.expires_at <= now),
        func.percentile_cont(0.5).within_group(
            func.extract("epoch", ApprovalLink.decided_at - ApprovalLink.created_at) / 60.0),
        func.count(func.distinct(ApprovalLink.workspace_id)),
    ).where(ApprovalLink.created_at >= since)
    created, opened, approved, changes, expired, median_min, workspaces_using = \
        (await db.execute(scoped(links, ApprovalLink.workspace_id))).one()

    decisions = (
        select(
            func.count(ApprovalLog.id).filter(ApprovalLog.approval_link_id.is_not(None)),
            func.count(ApprovalLog.id).filter(ApprovalLog.user_id.is_not(None)),
            func.count(ApprovalLog.id).filter(ApprovalLog.acted_by_assignee.is_(False)),
            func.count(ApprovalLog.id).filter(ApprovalLog.acted_by_assignee.is_not(None)),
        )
        .join(Post, Post.id == ApprovalLog.post_id).join(Brand, Brand.id == Post.brand_id)
        .where(ApprovalLog.action == ApprovalAction.APPROVED, ApprovalLog.created_at >= since)
    )
    by_client, by_manager, on_behalf, assigned_total = \
        (await db.execute(scoped(decisions, Brand.workspace_id))).one()

    contacts = await db.scalar(scoped(
        select(func.count(BrandContact.id)).where(BrandContact.is_active.is_(True)), BrandContact.workspace_id))

    return {
        "window_days": WINDOW_DAYS,
        "links_created": created,
        "links_opened": opened,
        "client_approved": approved,
        "client_changes_requested": changes,
        "links_expired_unanswered": expired,
        "median_client_response_minutes": round(median_min, 1) if median_min is not None else None,
        "approvals_by_client": by_client,
        "approvals_by_manager": by_manager,
        "on_behalf_percent": round(100.0 * on_behalf / assigned_total, 1) if assigned_total else None,
        "saved_contacts": contacts or 0,
        "workspaces_using_links": workspaces_using if workspace_id is None else None,
    }
