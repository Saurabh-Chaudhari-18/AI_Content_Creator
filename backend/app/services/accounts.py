"""Account rules shared by the customer API and the admin API.

Creating a workspace, adding a member and issuing a "set your password"
link follow ONE set of rules, written here, so the two APIs can never drift
apart. Nothing here commits: the caller owns the transaction and the audit
record.
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, func, insert, select

from app.config import settings
from app.core.security import hash_refresh_token
from app.models import (
    SetupTokenPurpose, UserSetupToken, Workspace, WorkspaceMember, WorkspaceRole,
)
from app.services.features import enforce_limit, get_feature
from app.services.plans import get_default_plan_id
from app.services.platform_settings import get_setting

# Stored for a login that has no password yet. It is not a bcrypt hash, so
# no password can ever match it; the user sets a real one from a setup link.
UNUSABLE_PASSWORD = "!"


def generate_slug(name: str) -> str:
    """URL-safe slug with a short random suffix (collisions are astronomically
    unlikely; the unique index is the final guard)."""
    base = re.sub(r"[^a-zA-Z0-9]+", "-", name.lower()).strip("-")[:80] or "workspace"
    return f"{base}-{secrets.token_hex(3)}"


async def create_workspace(db, *, owner_id: UUID, name: str, plan_id: UUID | None = None) -> Workspace:
    """A new workspace on the default plan (or `plan_id`), with its owner as
    the first member."""
    workspace = Workspace(
        name=name.strip(), slug=generate_slug(name), owner_id=owner_id,
        plan_id=plan_id or await get_default_plan_id(db),
    )
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner_id, role=WorkspaceRole.OWNER))
    return workspace


async def add_member(db, *, workspace_id: UUID, user_id: UUID, role: WorkspaceRole,
                     enable_review_on_second_member: bool) -> bool:
    """Add a user to a workspace, within the plan's member limit.

    Returns True when this also switched on "the author cannot approve their
    own post". That happens once, when the second member joins: from then on
    there is someone else to approve. It needs the approval workflow in the
    plan, and the customer API asks for it; the admin API does not, because
    that switch is the customer's own setting.
    """
    # Locked so two additions at once cannot both see "one member".
    workspace = await db.scalar(select(Workspace).where(Workspace.id == workspace_id).with_for_update())

    async def member_count() -> int:
        return await db.scalar(
            select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == workspace_id)
        )
    await enforce_limit(db, workspace_id, "max_members", member_count)
    members_before = await member_count()

    db.add(WorkspaceMember(workspace_id=workspace_id, user_id=user_id, role=role))

    if (enable_review_on_second_member and members_before == 1 and workspace.allow_self_approval
            and (await get_feature(db, workspace_id, "approval_workflow")).enabled):
        workspace.allow_self_approval = False
        return True
    return False


async def issue_setup_link(db, *, user_id: UUID, purpose: SetupTokenPurpose,
                           created_by_user_id: UUID | None) -> tuple[str, datetime]:
    """A one-time "set your password" link for a user. Returns (link, expiry).

    Only the SHA-256 of the token is stored, so the link exists nowhere after
    it is returned here. The user's older unused links are cancelled: at most
    one link works at a time.
    """
    await db.execute(
        delete(UserSetupToken).where(UserSetupToken.user_id == user_id, UserSetupToken.used_at.is_(None))
    )
    raw = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=await get_setting(db, "setup_link_hours"))
    await db.execute(insert(UserSetupToken).values(
        user_id=user_id, token_hash=hash_setup_token(raw), purpose=purpose,
        expires_at=expires_at, created_by_user_id=created_by_user_id,
    ))
    return f"{settings.FRONTEND_URL}/set-password?token={raw}", expires_at


def hash_setup_token(raw: str) -> str:
    return hash_refresh_token(raw)  # the same SHA-256 the session tokens use
