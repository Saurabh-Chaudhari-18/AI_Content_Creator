"""Shared pieces of the admin API.

Two rules every admin route follows:

- It uses `get_admin_db`, never `get_db`. That session runs as the
  `omnipost_admin` database role: customer content is read-only and secrets
  are unreadable at the database level. Because of that, the restricted
  tables (users, refresh_tokens, user_setup_tokens, social_accounts) are
  always read by naming columns — `select(User)` would ask for
  password_hash and be refused.
- Every change is written to the audit trail with the admin's reason,
  through `admin_audit`.
"""
from typing import Any
from uuid import NAMESPACE_OID, UUID, uuid5

from fastapi import HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import client_ip
from app.models import AuditAction, Plan, User, Workspace
from app.schemas.admin import REASON_MAX, REASON_MIN
from app.services.audit import record_audit_event

# The columns of `users` the admin role may read.
USER_COLUMNS = (User.id, User.email, User.full_name, User.is_active, User.platform_role,
                User.last_login_at, User.created_at)


def admin_audit(
    db: AsyncSession, admin: User, request: Request, *,
    action: AuditAction, entity_type: str, entity_id: UUID,
    workspace_id: UUID | None = None, changes: dict[str, Any] | None = None, reason: str | None = None,
) -> None:
    """Audit row for an admin action. With `workspace_id` it also shows in
    that customer's own audit log, marked as done by platform staff."""
    record_audit_event(
        db, action=action, entity_type=entity_type, entity_id=entity_id, workspace_id=workspace_id,
        user_id=admin.id, user_email=admin.email, user_name=admin.full_name,
        changes=changes, ip_address=client_ip(request), user_agent=request.headers.get("user-agent"),
        actor_platform_role=admin.platform_role.value, reason=reason,
    )


def key_entity_id(kind: str, key: str) -> UUID:
    """Audit rows need a UUID entity id; features and settings are named by
    a text key. This gives each key the same UUID every time, so its history
    can be filtered."""
    return uuid5(NAMESPACE_OID, f"omnipost:{kind}:{key}")


def paging(page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200)) -> tuple[int, int]:
    return page, limit


def reason_param(reason: str = Query(..., min_length=REASON_MIN, max_length=REASON_MAX)) -> str:
    """The reason for a DELETE, which has no body."""
    return reason.strip()


def like(term: str) -> str:
    """A contains-pattern for ILIKE with the user's wildcards made literal."""
    escaped = term.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found.")


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def workspace_or_404(db: AsyncSession, workspace_id: UUID, *, lock: bool = False) -> Workspace:
    stmt = select(Workspace).where(Workspace.id == workspace_id)
    workspace = await db.scalar(stmt.with_for_update() if lock else stmt)
    if workspace is None:
        raise not_found("Workspace")
    return workspace


async def user_or_404(db: AsyncSession, user_id: UUID):
    """The user's readable columns (a Row, not a User object)."""
    row = (await db.execute(select(*USER_COLUMNS).where(User.id == user_id))).one_or_none()
    if row is None:
        raise not_found("User")
    return row


async def plan_by_key(db: AsyncSession, key: str, *, assignable: bool = False) -> Plan:
    plan = await db.scalar(select(Plan).where(Plan.key == key))
    if plan is None:
        raise bad_request(f"There is no plan '{key}'.")
    if assignable and not plan.is_active:
        raise bad_request(f"The plan '{key}' is retired and cannot be given to a workspace.")
    return plan
