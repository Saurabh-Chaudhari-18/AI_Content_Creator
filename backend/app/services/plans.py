"""Plans — which plan a workspace is on.

The rows live in the database and are changed from the admin panel; the
first set is seeded by migration 0005_admin_platform.
"""
from uuid import UUID

from sqlalchemy import select

from app.models import Plan


async def get_default_plan_id(db) -> UUID:
    """The plan every newly created workspace starts on (plans.is_default)."""
    plan_id = await db.scalar(select(Plan.id).where(Plan.is_default.is_(True), Plan.is_active.is_(True)))
    if plan_id is None:
        raise RuntimeError(
            "No default plan in the database. Run `python -m alembic upgrade head` "
            "(migration 0005_admin_platform seeds the plans)."
        )
    return plan_id
