"""Shared FastAPI dependencies — the single tenancy choke-point.

Every workspace-scoped route resolves access through get_workspace_member /
get_post_access here, never through ad-hoc joins in route bodies.
"""
import ipaddress
from uuid import UUID

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.core.middleware import request_is_write
from app.models import (
    Brand, PlatformRole, Post, User, Workspace, WorkspaceMember, WorkspaceRole, WorkspaceStatus,
)

bearer_scheme = HTTPBearer(auto_error=False)

APPROVER_ROLES = (WorkspaceRole.OWNER, WorkspaceRole.ADMIN)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Validate the Bearer JWT and load the active user."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (pyjwt.PyJWTError, KeyError, ValueError):
        raise unauthorized from None

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise unauthorized
    return user


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    """Gate for every /admin route. The role is read from the database on
    each request (get_current_user loads the row), so removing it takes
    effect at once. 404, not 403: the admin API does not exist for customers."""
    if user.platform_role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return user


WORKSPACE_SUSPENDED_DETAIL = "This workspace is suspended. Contact support to restore it."


async def assert_workspace_writable(db: AsyncSession, workspace_id: UUID) -> None:
    """A suspended workspace is read-only: its members can sign in and look,
    nothing can be created, changed or published. Called by the tenancy
    helpers below on every request that changes something."""
    if not request_is_write.get():
        return
    workspace_status = await db.scalar(select(Workspace.status).where(Workspace.id == workspace_id))
    if workspace_status == WorkspaceStatus.SUSPENDED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=WORKSPACE_SUSPENDED_DETAIL,
            headers={"X-Plan-Restriction": "workspace_suspended"},
        )


async def get_workspace_member(
    workspace_id: UUID,
    db: AsyncSession,
    user: User,
) -> WorkspaceMember:
    """Resolve the caller's membership in a workspace. 404 (not 403) when
    absent, so outsiders can't probe which workspace IDs exist."""
    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")
    await assert_workspace_writable(db, workspace_id)
    return member


def require_role(member: WorkspaceMember, *roles: WorkspaceRole) -> None:
    if member.role not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient workspace permissions for this action.",
        )


async def get_brand_access(brand_id: UUID, db: AsyncSession, user: User) -> Brand:
    """Load a brand only if the caller is a member of its workspace."""
    brand = await db.scalar(
        select(Brand)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Brand.workspace_id)
        .where(Brand.id == brand_id, WorkspaceMember.user_id == user.id)
    )
    if brand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand not found.")
    await assert_workspace_writable(db, brand.workspace_id)
    return brand


async def get_post_access(post_id: UUID, db: AsyncSession, user: User) -> Post:
    """Load a post (media eager-loaded) only if the caller is a member of its workspace."""
    post = await db.scalar(
        select(Post)
        .options(selectinload(Post.media))
        .join(Brand, Brand.id == Post.brand_id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Brand.workspace_id)
        .where(Post.id == post_id, WorkspaceMember.user_id == user.id)
    )
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")
    if request_is_write.get():
        workspace_id = await db.scalar(select(Brand.workspace_id).where(Brand.id == post.brand_id))
        await assert_workspace_writable(db, workspace_id)
    return post


async def get_post_membership(post: Post, db: AsyncSession, user: User) -> WorkspaceMember:
    """The caller's membership (role) in the post's workspace."""
    member = await db.scalar(
        select(WorkspaceMember)
        .join(Brand, Brand.workspace_id == WorkspaceMember.workspace_id)
        .where(Brand.id == post.brand_id, WorkspaceMember.user_id == user.id)
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")
    return member


def client_ip(request: Request) -> str:
    """Best-effort client address for rate limiting and audit rows.

    X-Forwarded-For is attacker-controlled unless the app sits behind a
    proxy that overwrites it, so it is honoured ONLY when
    TRUST_X_FORWARDED_FOR is set. The value is validated as an IP literal and
    always fits the 45-char ip_address columns — a junk header must never
    turn into a 500 on /login.
    """
    peer = request.client.host if request.client else "unknown"
    if not settings.TRUST_X_FORWARDED_FOR:
        return peer[:45]
    forwarded = request.headers.get("X-Forwarded-For", "")
    # With N trusted proxies the real client is the Nth address from the right.
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    if len(hops) >= settings.TRUSTED_PROXY_COUNT >= 1:
        candidate = hops[-settings.TRUSTED_PROXY_COUNT]
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    return peer[:45]
