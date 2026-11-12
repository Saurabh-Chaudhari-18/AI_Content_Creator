"""Platform settings — reading the values the admin panel controls.

Definitions live in app/core/settings_registry.py; values in the
`platform_settings` table.
"""
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.settings_registry import SETTINGS, SETTINGS_BY_KEY
from app.models import PlatformSetting


async def get_setting(db, key: str) -> Any:
    """The current value, read from the database on every call. Falls back
    to the code default if the row is missing or holds an invalid value."""
    definition = SETTINGS_BY_KEY[key]  # KeyError = a typo in code, never a silent default
    value = await db.scalar(select(PlatformSetting.value).where(PlatformSetting.key == key))
    if value is None:
        return definition.default
    try:
        return definition.validate(value)
    except ValueError:
        return definition.default


def sync_settings_registry(conn) -> None:
    """Create the row for every setting defined in code (startup, plain sync
    connection). An existing row's value is never touched — it belongs to
    the admin panel; only its description and type are refreshed."""
    rows = [{"key": s.key, "value": s.default, "value_type": s.value_type, "description": s.description}
            for s in SETTINGS]
    insert = pg_insert(PlatformSetting).values(rows)
    conn.execute(insert.on_conflict_do_update(
        index_elements=[PlatformSetting.key],
        set_={"value_type": insert.excluded.value_type, "description": insert.excluded.description},
        where=(PlatformSetting.value_type != insert.excluded.value_type)
        | (PlatformSetting.description != insert.excluded.description),
    ))
