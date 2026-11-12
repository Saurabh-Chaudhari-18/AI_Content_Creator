"""Platform settings registry — settings the super admin changes from the
admin panel that are not per-plan features.

This file DEFINES each setting (key, type, default, allowed range); the
`platform_settings` table stores its current VALUE. Code reads a setting
with app.services.platform_settings.get_setting, never from .env or a
constant, so a change in the admin panel applies on the next request.

Adding a setting: add a SettingDef below and read it where it applies. The
row is created at startup. Never rename a key.
See docs/omnipost-docs/08_admin_panel_database.md §5.
"""
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SettingDef:
    key: str
    value_type: str          # boolean | integer | string
    default: Any
    description: str
    minimum: int | None = None   # integer settings only
    maximum: int | None = None

    def validate(self, value: Any) -> Any:
        """Return the value if it is valid for this setting, else raise ValueError."""
        if self.value_type == "boolean":
            if not isinstance(value, bool):
                raise ValueError("must be true or false")
        elif self.value_type == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("must be a whole number")
            if self.minimum is not None and value < self.minimum:
                raise ValueError(f"must be at least {self.minimum}")
            if self.maximum is not None and value > self.maximum:
                raise ValueError(f"must be at most {self.maximum}")
        elif self.value_type == "string":
            if not isinstance(value, str):
                raise ValueError("must be text")
        return value


SETTINGS: tuple[SettingDef, ...] = (
    SettingDef(
        "setup_link_hours", "integer", 48,
        "How long a 'set your password' link stays valid, in hours.",
        minimum=1, maximum=720,
    ),
)

SETTINGS_BY_KEY: dict[str, SettingDef] = {s.key: s for s in SETTINGS}
