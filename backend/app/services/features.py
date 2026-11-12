"""Plan features and limits — deciding what a workspace is allowed to do.

How a feature is decided, first answer wins:

1. `features.global_enabled` is false  -> OFF for everyone (kill switch)
2. a live per-workspace override exists -> the override
3. the workspace's plan includes it     -> the plan value
4. otherwise                            -> OFF

The values are read from the database on every check, so a change made in
the admin panel applies to the customer's very next request. Routes call
require_feature / enforce_limit; the frontend reads the same result from
GET /workspaces/{id}/features, but only to decide what to show — these
functions are the gate.

What turning a feature OFF does: it stops NEW use. Work that already
depends on it is left alone — posts already scheduled still publish (the
worker does not check features), and a setting already switched on stays on.
"""
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.features import FEATURES, FEATURES_BY_KEY, FeatureDef
from app.models import (
    Feature, FeatureValueType, PlanFeature, SocialPlatform, Workspace, WorkspaceFeatureOverride,
)

logger = logging.getLogger(__name__)

# Response headers that let the frontend tell a plan restriction apart from
# an ordinary 403 (and re-read the workspace's features) without parsing text.
PLAN_RESTRICTION_HEADER = "X-Plan-Restriction"   # feature_disabled | limit_reached
PLAN_FEATURE_HEADER = "X-Plan-Feature"           # the feature key

PLATFORM_FEATURE: dict[SocialPlatform, str] = {
    SocialPlatform.FACEBOOK: "facebook_publishing",
    SocialPlatform.INSTAGRAM: "instagram_publishing",
    SocialPlatform.LINKEDIN: "linkedin_publishing",
}


@dataclass(frozen=True)
class FeatureValue:
    key: str
    enabled: bool
    limit: int | None   # limit features only; None = unlimited
    source: str         # global_off | override | plan | none

    @property
    def definition(self) -> FeatureDef:
        return FEATURES_BY_KEY[self.key]


def _off(key: str) -> FeatureValue:
    return FeatureValue(key=key, enabled=False, limit=None, source="none")


# ── Resolving ──────────────────────────────────────────────────────────
async def resolve_features(db, workspace_id: UUID, keys: tuple[str, ...] | None = None) -> dict[str, FeatureValue]:
    """Every registered feature (or just `keys`) for one workspace."""
    return (await resolve_features_bulk(db, [workspace_id], keys))[workspace_id]


async def resolve_features_bulk(
    db, workspace_ids: list[UUID], keys: tuple[str, ...] | None = None,
) -> dict[UUID, dict[str, FeatureValue]]:
    """resolve_features for many workspaces in one query (admin reports)."""
    wanted = keys or tuple(FEATURES_BY_KEY)
    for key in wanted:
        if key not in FEATURES_BY_KEY:  # a typo in code must never read as "off"
            raise KeyError(f"Unknown feature {key!r}: add it to app/core/features.py")

    override = WorkspaceFeatureOverride
    stmt = (
        select(
            Workspace.id, Feature.key, Feature.global_enabled,
            PlanFeature.enabled, PlanFeature.limit_value,
            override.id, override.enabled, override.limit_value,
        )
        .select_from(Feature)
        .join(Workspace, Workspace.id.in_(workspace_ids))
        .outerjoin(PlanFeature, and_(PlanFeature.feature_key == Feature.key,
                                     PlanFeature.plan_id == Workspace.plan_id))
        .outerjoin(override, and_(override.feature_key == Feature.key,
                                  override.workspace_id == Workspace.id,
                                  or_(override.expires_at.is_(None), override.expires_at > func.now())))
        .where(Feature.is_active.is_(True), Feature.key.in_(wanted))
    )
    # Not in the database = off.
    resolved = {ws_id: {key: _off(key) for key in wanted} for ws_id in workspace_ids}
    if not workspace_ids:
        return resolved
    rows = (await db.execute(stmt)).all()
    for ws_id, key, global_enabled, plan_enabled, plan_limit, override_id, o_enabled, o_limit in rows:
        is_limit = FEATURES_BY_KEY[key].value_type == FeatureValueType.LIMIT
        if not global_enabled:
            resolved[ws_id][key] = FeatureValue(key, False, None, "global_off")
        elif override_id is not None:
            resolved[ws_id][key] = FeatureValue(key, bool(o_enabled), o_limit if is_limit else None, "override")
        elif plan_enabled is not None:
            resolved[ws_id][key] = FeatureValue(key, bool(plan_enabled), plan_limit if is_limit else None, "plan")
    return resolved


async def get_feature(db, workspace_id: UUID, key: str) -> FeatureValue:
    return (await resolve_features(db, workspace_id, (key,)))[key]


# ── Enforcing ──────────────────────────────────────────────────────────
def _restriction(kind: str, key: str, detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail=detail,
        headers={PLAN_RESTRICTION_HEADER: kind, PLAN_FEATURE_HEADER: key},
    )


def feature_disabled_error(value: FeatureValue) -> HTTPException:
    name = value.definition.name
    if value.source == "global_off":
        return _restriction("feature_disabled", value.key, f"{name} is temporarily unavailable.")
    return _restriction("feature_disabled", value.key, f"{name} isn't included in your plan.")


def assert_enabled(value: FeatureValue) -> None:
    if not value.enabled:
        raise feature_disabled_error(value)


async def require_feature(db, workspace_id: UUID, key: str) -> FeatureValue:
    """403 unless the workspace has the feature."""
    value = await get_feature(db, workspace_id, key)
    assert_enabled(value)
    return value


async def enforce_limit(
    db, workspace_id: UUID, key: str, count_used: Callable[[], Awaitable[int]],
    *, adding: int = 1, message: str | None = None,
) -> None:
    """403 if `adding` more would take the workspace past its limit.

    `count_used` counts what the workspace has now. It runs only when there
    is a number to compare against, and only after the workspace row is
    locked, so two requests at the same moment cannot both squeeze under
    the limit. Call this before inserting, in the same transaction.
    """
    value = await require_feature(db, workspace_id, key)
    if value.limit is None:  # unlimited
        return
    await db.execute(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update())
    used = await count_used()
    if used + adding > value.limit:
        raise _restriction(
            "limit_reached", key,
            message or f"You've reached your plan's limit for {value.definition.name.lower()} ({value.limit}).",
        )


# ── Startup sync: code registry -> features table ──────────────────────
def sync_feature_registry(conn) -> None:
    """Make the `features` table match app/core/features.py.

    Runs on a plain (sync) connection at startup. New keys are inserted with
    their registry kill-switch value; names and descriptions are refreshed;
    keys no longer in code are marked inactive (never deleted — plans and
    overrides reference them). `global_enabled` of an existing row is never
    touched: that value belongs to the admin panel.

    A newly added feature is in no plan yet, so it is OFF for every workspace
    until it is added to plans from the admin panel.
    """
    rows = [
        {"key": f.key, "name": f.name, "description": f.description, "value_type": f.value_type,
         "category": f.category, "global_enabled": f.global_enabled, "is_active": True}
        for f in FEATURES
    ]
    insert = pg_insert(Feature).values(rows)
    conn.execute(insert.on_conflict_do_update(
        index_elements=[Feature.key],
        set_={
            "name": insert.excluded.name, "description": insert.excluded.description,
            "value_type": insert.excluded.value_type, "category": insert.excluded.category,
            "is_active": True, "updated_at": func.now(),
        },
        # Skip rows that already match, so a normal restart writes nothing.
        where=or_(
            Feature.name != insert.excluded.name, Feature.description != insert.excluded.description,
            Feature.value_type != insert.excluded.value_type, Feature.category != insert.excluded.category,
            Feature.is_active.is_(False),
        ),
    ))
    retired = conn.execute(
        Feature.__table__.update()
        .where(Feature.key.not_in([f.key for f in FEATURES]), Feature.is_active.is_(True))
        .values(is_active=False, updated_at=func.now())
        .returning(Feature.key)
    ).scalars().all()
    if retired:
        logger.warning("features removed from the code registry, now inactive: %s", ", ".join(sorted(retired)))
