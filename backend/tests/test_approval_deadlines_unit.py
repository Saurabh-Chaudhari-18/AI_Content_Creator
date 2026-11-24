"""Pure helpers for approval deadlines and certificates (no database)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import ReminderStage
from app.services import approval_deadlines as d
from app.services import certificates as c

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
BOUNDS = d.DueBounds(min_hours=1, max_hours=336, default_hours=48, escalate_default_hours=24)


def stage(due_in_h, submitted_ago_h=72, escalate=24):
    return d.current_stage(due_at=NOW + timedelta(hours=due_in_h),
                           submitted_at=NOW - timedelta(hours=submitted_ago_h),
                           escalate_after_hours=escalate, now=NOW)


def test_stages_follow_the_clock():
    assert stage(30) is None
    assert stage(5) == ReminderStage.DUE_SOON
    assert stage(0) == ReminderStage.OVERDUE
    assert stage(-23) == ReminderStage.OVERDUE
    assert stage(-24) == ReminderStage.ESCALATED
    assert stage(-2, escalate=1) == ReminderStage.ESCALATED


def test_short_round_never_gets_due_soon():
    # Submitted 1 h ago, due in 5 h: the round is shorter than the 24 h window.
    assert stage(5, submitted_ago_h=1) is None
    assert stage(-1, submitted_ago_h=1) == ReminderStage.OVERDUE


def test_bounds_stay_ordered_and_defaults_cascade():
    bounds = d._bounds({"approval_due_min_hours": 500, "approval_due_max_hours": 100,
                        "approval_due_default_hours": 1, "approval_escalate_default_hours": 24})
    assert bounds.min_hours == bounds.max_hours == bounds.default_hours == 100

    ws = SimpleNamespace(approval_due_default_hours=None)
    brand = SimpleNamespace(approval_due_hours=None, approval_escalate_after_hours=None)
    assert d.default_hours(BOUNDS, ws, brand) == 48
    ws.approval_due_default_hours = 12
    assert d.default_hours(BOUNDS, ws, brand) == 12
    brand.approval_due_hours = 6
    assert d.default_hours(BOUNDS, ws, brand) == 6
    brand.approval_due_hours = 9999           # out of range after the admin narrowed it
    assert d.default_hours(BOUNDS, ws, brand) == 336
    assert d.escalate_hours(BOUNDS, brand) == 24


def test_choose_due_at_checks_the_range():
    ws = SimpleNamespace(approval_due_default_hours=None)
    brand = SimpleNamespace(approval_due_hours=None)
    assert d.choose_due_at(BOUNDS, ws, brand, None, NOW) == NOW + timedelta(hours=48)
    assert d.choose_due_at(BOUNDS, ws, brand, NOW + timedelta(hours=1), NOW) == NOW + timedelta(hours=1)
    for bad in (NOW + timedelta(minutes=30), NOW + timedelta(days=15), NOW.replace(tzinfo=None)):
        with pytest.raises(HTTPException) as exc:
            d.choose_due_at(BOUNDS, ws, brand, bad + timedelta(hours=2) if bad.tzinfo is None else bad, NOW)
        assert exc.value.status_code == 400


def test_deadline_wording_always_has_a_zone():
    when = datetime(2026, 11, 28, 12, 30, tzinfo=timezone.utc)
    assert d.format_deadline(when, "Asia/Kolkata") == "6:00 pm IST, 28 Nov"
    assert d.format_deadline(when, None) == "12:30 pm UTC, 28 Nov"
    assert d.format_deadline(when, "Not/AZone") == "12:30 pm UTC, 28 Nov"
    assert d.valid_zone("Europe/London") == "Europe/London" and d.valid_zone("x") is None


def test_certificate_numbers():
    ids = {c.new_public_id() for _ in range(200)}
    assert len(ids) == 200 and all(len(i) == 12 and not set(i) & set("01OIL") for i in ids)
    one = next(iter(ids))
    assert c.normalise_id(c.display_id(one).lower()) == one
    assert c.normalise_id(" " + c.display_id(one) + " ") == one
    assert c.normalise_id("O000-0000-0000") is None and c.normalise_id("short") is None
