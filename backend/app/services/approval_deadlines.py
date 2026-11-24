"""Approval deadlines ("Needed by") and the reminder schedule.

Plan: docs/approval_reminders_certificate_plan.md §2.

Levels, like link lifetimes (client_approval_link_plan.md D5):
- the platform range and defaults (super admin, platform_settings),
- the workspace default and each brand's default (owner/admin),
- the person submitting may pick any deadline inside the platform range.

Reminder stages for one review round (one `submitted` history row):
- due_soon   24 h before the deadline — only when the round is longer than
             24 h, otherwise the reminder would arrive with the request
- overdue    at the deadline
- escalated  `escalate_after` hours after the deadline, to every manager
Only the latest due stage is ever sent: a stage missed while the worker was
down is skipped, since nobody needs "due in 24 h" for an overdue post.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status

from app.core.settings_registry import SETTINGS_BY_KEY
from app.models import Brand, ReminderStage, Workspace

DUE_SOON_WINDOW = timedelta(hours=24)
# A deadline picked in the browser a few seconds before submitting must not
# fail the "at least N hours away" check.
CLOCK_SLACK = timedelta(minutes=2)

_KEYS = ("approval_due_min_hours", "approval_due_max_hours", "approval_due_default_hours",
         "approval_escalate_default_hours")


@dataclass(frozen=True)
class DueBounds:
    min_hours: int
    max_hours: int
    default_hours: int
    escalate_default_hours: int


def _bounds(values: dict) -> DueBounds:
    lo, hi = values["approval_due_min_hours"], values["approval_due_max_hours"]
    lo = min(lo, hi)
    default = max(lo, min(values["approval_due_default_hours"], hi))
    return DueBounds(lo, hi, default, values["approval_escalate_default_hours"])


async def due_bounds(db) -> DueBounds:
    from app.services.platform_settings import get_setting

    return _bounds({k: await get_setting(db, k) for k in _KEYS})


def due_bounds_sync(db) -> DueBounds:
    """The same, on a worker (plain) session."""
    from sqlalchemy import select

    from app.models import PlatformSetting

    stored = dict(db.execute(select(PlatformSetting.key, PlatformSetting.value)
                             .where(PlatformSetting.key.in_(_KEYS))).all())
    values = {}
    for key in _KEYS:
        definition = SETTINGS_BY_KEY[key]
        try:
            values[key] = definition.validate(stored[key]) if stored.get(key) is not None else definition.default
        except ValueError:
            values[key] = definition.default
    return _bounds(values)


def clamp_hours(bounds: DueBounds, hours: int) -> int:
    return max(bounds.min_hours, min(hours, bounds.max_hours))


def default_hours(bounds: DueBounds, workspace: Workspace, brand: Brand | None) -> int:
    """Brand → workspace → platform, always inside the platform range."""
    value = (brand.approval_due_hours if brand is not None else None) \
        or workspace.approval_due_default_hours or bounds.default_hours
    return clamp_hours(bounds, value)


def escalate_hours(bounds: DueBounds, brand: Brand | None) -> int:
    return (brand.approval_escalate_after_hours if brand is not None else None) or bounds.escalate_default_hours


def check_hours_in_range(bounds: DueBounds, hours: int) -> None:
    """Workspace and brand defaults must sit inside the platform range."""
    if not bounds.min_hours <= hours <= bounds.max_hours:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Choose between {describe_hours(bounds.min_hours)} and "
                            f"{describe_hours(bounds.max_hours)}.")


def choose_due_at(bounds: DueBounds, workspace: Workspace, brand: Brand,
                  requested: datetime | None, now: datetime) -> datetime:
    if requested is None:
        return now + timedelta(hours=default_hours(bounds, workspace, brand))
    if requested.tzinfo is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The deadline needs a time zone.")
    earliest = now + timedelta(hours=bounds.min_hours) - CLOCK_SLACK
    latest = now + timedelta(hours=bounds.max_hours) + CLOCK_SLACK
    if not earliest <= requested <= latest:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Pick a deadline between {describe_hours(bounds.min_hours)} and "
            f"{describe_hours(bounds.max_hours)} from now.",
        )
    return requested


def valid_zone(name: str | None) -> str | None:
    """An IANA zone name, or None. Display only — never used for logic."""
    if not name:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return name


def describe_hours(hours: int) -> str:
    if hours % 24 == 0:
        days = hours // 24
        return f"{days} day{'s' if days != 1 else ''}"
    return f"{hours} hour{'s' if hours != 1 else ''}"


def format_deadline(when: datetime, zone: str | None) -> str:
    """"6:00 pm IST, 28 Nov" — always with the zone label (plan D14)."""
    tz = ZoneInfo(valid_zone(zone) or "UTC")
    local = when.astimezone(tz)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{hour}:{local:%M} {local:%p}".lower().replace("am", "am").replace("pm", "pm") \
        + f" {local:%Z}, {local.day} {local:%b}"


def current_stage(*, due_at: datetime, submitted_at: datetime, escalate_after_hours: int,
                  now: datetime) -> ReminderStage | None:
    """The latest stage that is due now, or None. The caller sends it unless
    it was already sent this round; earlier missed stages are never sent."""
    if now >= due_at + timedelta(hours=escalate_after_hours):
        return ReminderStage.ESCALATED
    if now >= due_at:
        return ReminderStage.OVERDUE
    if due_at - DUE_SOON_WINDOW <= now and due_at - submitted_at > DUE_SOON_WINDOW:
        return ReminderStage.DUE_SOON
    return None
