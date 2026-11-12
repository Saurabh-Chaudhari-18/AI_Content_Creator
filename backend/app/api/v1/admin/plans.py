"""Admin: plans, the global feature switches, and platform settings.

These are the values behind "what does a customer get". They live in the
database and are changed only here; every change applies to the next
customer request and is audited with a reason.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.common import admin_audit, bad_request, key_entity_id, not_found, plan_by_key
from app.core.dependencies import require_super_admin
from app.core.features import FEATURES, FEATURES_BY_KEY
from app.core.settings_registry import SETTINGS, SETTINGS_BY_KEY
from app.db.session import get_admin_db
from app.models import (
    AuditAction, Feature, FeatureValueType, Plan, PlanFeature, PlatformSetting, User, Workspace,
)
from app.schemas.admin import (
    AdminFeature, AdminPlan, AdminPlanCreate, AdminPlanUpdate, AdminSetting, FeatureValueIn,
    GlobalSwitchIn, PlanFeatureValue, Reasoned, SettingIn,
)

router = APIRouter()


# ── Plans ─────────────────────────────────────────────────────────────
async def _plans(db: AsyncSession, plan_id: UUID | None = None) -> list[AdminPlan]:
    stmt = select(Plan).order_by(Plan.sort_order, Plan.key)
    plans = (await db.execute(stmt.where(Plan.id == plan_id) if plan_id else stmt)).scalars().all()
    counts = dict((await db.execute(
        select(Workspace.plan_id, func.count(Workspace.id)).group_by(Workspace.plan_id))).all())
    values: dict[UUID, dict[str, PlanFeature]] = {}
    for pf in (await db.execute(select(PlanFeature))).scalars():
        values.setdefault(pf.plan_id, {})[pf.feature_key] = pf

    result = []
    for plan in plans:
        mine = values.get(plan.id, {})
        result.append(AdminPlan(
            id=plan.id, key=plan.key, name=plan.name, description=plan.description,
            is_default=plan.is_default, is_active=plan.is_active, sort_order=plan.sort_order,
            workspace_count=counts.get(plan.id, 0),
            features={
                f.key: PlanFeatureValue(
                    enabled=bool(mine[f.key].enabled) if f.key in mine else False,
                    limit=mine[f.key].limit_value if f.key in mine else None,
                )
                for f in FEATURES
            },
        ))
    return result


async def _plan_or_404(db: AsyncSession, plan_id: UUID) -> Plan:
    plan = await db.scalar(select(Plan).where(Plan.id == plan_id))
    if plan is None:
        raise not_found("Plan")
    return plan


@router.get("/plans", response_model=list[AdminPlan])
async def list_plans(db: AsyncSession = Depends(get_admin_db)):
    return await _plans(db)


@router.post("/plans", response_model=AdminPlan, status_code=status.HTTP_201_CREATED)
async def create_plan(req: AdminPlanCreate, request: Request,
                      db: AsyncSession = Depends(get_admin_db),
                      admin: User = Depends(require_super_admin)):
    """A new plan. Every feature starts OFF unless `copy_from_key` names a
    plan to copy the values from."""
    if await db.scalar(select(Plan.id).where(Plan.key == req.key)):
        raise bad_request(f"A plan with the key '{req.key}' already exists.")
    source = await plan_by_key(db, req.copy_from_key) if req.copy_from_key else None

    plan = Plan(key=req.key, name=req.name.strip(), description=req.description, sort_order=req.sort_order)
    db.add(plan)
    await db.flush()
    if source is not None:
        for pf in (await db.execute(select(PlanFeature).where(PlanFeature.plan_id == source.id))).scalars():
            db.add(PlanFeature(plan_id=plan.id, feature_key=pf.feature_key,
                               enabled=pf.enabled, limit_value=pf.limit_value))
    admin_audit(db, admin, request, action=AuditAction.CREATE, entity_type="Plan", entity_id=plan.id,
                reason=req.reason, changes={"after": {"key": plan.key, "name": plan.name,
                                                      "copied_from": source.key if source else None}})
    await db.commit()
    return (await _plans(db, plan.id))[0]


@router.patch("/plans/{plan_id}", response_model=AdminPlan)
async def update_plan(plan_id: UUID, req: AdminPlanUpdate, request: Request,
                      db: AsyncSession = Depends(get_admin_db),
                      admin: User = Depends(require_super_admin)):
    """Rename, reorder or retire a plan. A retired plan keeps its current
    workspaces but cannot be given to another one."""
    plan = await _plan_or_404(db, plan_id)
    before, after = {}, {}
    for field in ("name", "description", "sort_order", "is_active"):
        new = getattr(req, field)
        if new is None or new == getattr(plan, field):
            continue
        if field == "is_active" and new is False and plan.is_default:
            raise bad_request("The default plan cannot be retired. Make another plan the default first.")
        before[field], after[field] = getattr(plan, field), new
        setattr(plan, field, new.strip() if field == "name" else new)
    if after:
        admin_audit(db, admin, request, action=AuditAction.UPDATE, entity_type="Plan", entity_id=plan.id,
                    reason=req.reason, changes={"before": before, "after": after})
        await db.commit()
    return (await _plans(db, plan_id))[0]


@router.post("/plans/{plan_id}/make-default", response_model=AdminPlan)
async def make_default_plan(plan_id: UUID, req: Reasoned, request: Request,
                            db: AsyncSession = Depends(get_admin_db),
                            admin: User = Depends(require_super_admin)):
    """The plan every NEW workspace starts on. Existing workspaces keep
    their plan."""
    plan = await _plan_or_404(db, plan_id)
    if not plan.is_active:
        raise bad_request("A retired plan cannot be the default.")
    if not plan.is_default:
        previous = await db.scalar(select(Plan.key).where(Plan.is_default.is_(True)))
        # Two statements, in this order: the database allows one default at a time.
        await db.execute(update(Plan).where(Plan.is_default.is_(True)).values(is_default=False))
        await db.execute(update(Plan).where(Plan.id == plan_id).values(is_default=True))
        admin_audit(db, admin, request, action=AuditAction.PLAN_CHANGE, entity_type="Plan", entity_id=plan.id,
                    reason=req.reason, changes={"before": {"default_plan": previous},
                                                "after": {"default_plan": plan.key}})
        await db.commit()
    db.expire_all()
    return (await _plans(db, plan_id))[0]


@router.put("/plans/{plan_id}/features/{key}", response_model=AdminPlan)
async def set_plan_feature(plan_id: UUID, key: str, req: FeatureValueIn, request: Request,
                           db: AsyncSession = Depends(get_admin_db),
                           admin: User = Depends(require_super_admin)):
    """What this plan includes for one feature: on or off, and for a limit
    feature the number (null = unlimited). Applies at once to every
    workspace on the plan that has no override of its own."""
    plan = await _plan_or_404(db, plan_id)
    definition = FEATURES_BY_KEY.get(key)
    if definition is None:
        raise not_found("Feature")
    if definition.value_type == FeatureValueType.BOOLEAN and req.limit is not None:
        raise bad_request(f"'{definition.name}' is an on/off feature and takes no limit.")

    value = await db.scalar(select(PlanFeature).where(
        PlanFeature.plan_id == plan_id, PlanFeature.feature_key == key))
    before = None
    if value is None:
        value = PlanFeature(plan_id=plan_id, feature_key=key)
        db.add(value)
    else:
        before = {"enabled": value.enabled, "limit": value.limit_value}
    value.enabled = req.enabled
    value.limit_value = req.limit
    admin_audit(db, admin, request, action=AuditAction.FEATURE_CHANGE, entity_type="Plan", entity_id=plan.id,
                reason=req.reason, changes={"plan": plan.key, "feature": key, "before": before,
                                            "after": {"enabled": req.enabled, "limit": req.limit}})
    await db.commit()
    return (await _plans(db, plan_id))[0]


# ── Global feature switches ───────────────────────────────────────────
def _feature(row: Feature) -> AdminFeature:
    return AdminFeature(key=row.key, name=row.name, description=row.description,
                        value_type=row.value_type.value, category=row.category,
                        global_enabled=row.global_enabled, is_active=row.is_active)


@router.get("/features", response_model=list[AdminFeature])
async def list_features(db: AsyncSession = Depends(get_admin_db)):
    """Every feature that exists, with its switch. The list itself comes
    from code (app/core/features.py); only the switch is changed here."""
    rows = {f.key: f for f in (await db.execute(select(Feature).where(Feature.is_active.is_(True)))).scalars()}
    return [_feature(rows[f.key]) for f in FEATURES if f.key in rows]


@router.patch("/features/{key}", response_model=AdminFeature)
async def set_global_switch(key: str, req: GlobalSwitchIn, request: Request,
                            db: AsyncSession = Depends(get_admin_db),
                            admin: User = Depends(require_super_admin)):
    """Turn a feature off for EVERYONE, whatever their plan or override —
    or back on. For an outage, or a feature that is not released yet."""
    feature = await db.scalar(select(Feature).where(Feature.key == key, Feature.is_active.is_(True)))
    if feature is None or key not in FEATURES_BY_KEY:
        raise not_found("Feature")
    if feature.global_enabled != req.global_enabled:
        before, feature.global_enabled = feature.global_enabled, req.global_enabled
        admin_audit(db, admin, request, action=AuditAction.FEATURE_CHANGE, entity_type="Feature",
                    entity_id=key_entity_id("feature", key), reason=req.reason,
                    changes={"feature": key, "before": {"global_enabled": before},
                             "after": {"global_enabled": req.global_enabled}})
        await db.commit()
    return _feature(feature)


# ── Platform settings ─────────────────────────────────────────────────
@router.get("/settings", response_model=list[AdminSetting])
async def list_settings(db: AsyncSession = Depends(get_admin_db)):
    rows = {s.key: s for s in (await db.execute(select(PlatformSetting))).scalars()}
    return [
        AdminSetting(
            key=s.key, value=rows[s.key].value if s.key in rows else s.default, value_type=s.value_type,
            description=s.description, default=s.default, minimum=s.minimum, maximum=s.maximum,
            updated_at=rows[s.key].updated_at if s.key in rows else None,
        )
        for s in SETTINGS
    ]


@router.patch("/settings/{key}", response_model=list[AdminSetting])
async def update_setting(key: str, req: SettingIn, request: Request,
                         db: AsyncSession = Depends(get_admin_db),
                         admin: User = Depends(require_super_admin)):
    definition = SETTINGS_BY_KEY.get(key)
    if definition is None:
        raise not_found("Setting")
    try:
        definition.validate(req.value)
    except ValueError as exc:
        raise bad_request(f"{key} {exc}.") from None

    setting = await db.scalar(select(PlatformSetting).where(PlatformSetting.key == key))
    if setting is None:  # rows are created at startup, by the application's own database user
        raise bad_request("This setting has no row yet. Restart the API once to create it.")
    if setting.value != req.value:
        before, setting.value = setting.value, req.value
        setting.updated_by_user_id = admin.id
        admin_audit(db, admin, request, action=AuditAction.SETTING_CHANGE, entity_type="PlatformSetting",
                    entity_id=key_entity_id("setting", key), reason=req.reason,
                    changes={"setting": key, "before": {"value": before}, "after": {"value": req.value}})
        await db.commit()
    return await list_settings(db)
