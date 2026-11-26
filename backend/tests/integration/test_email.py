"""Outgoing email: approval emails, client reminders with opt-out, forgot
password, retries and the daily cap (docs/approval_reminders_certificate_plan.md §10).

The test backend ("memory") keeps what would be sent in mailer.SENT.
"""
import re
import uuid

import pytest

from app.services import email as mailer

from .conftest import register
from .test_approval_deadlines import _post, _run_reminders, _set_round
from .test_client_approvals import API, _set_setting, contact, draft, submit, team
from .test_plan_features import assert_blocked, set_override


def _send() -> dict:
    from app.workers.tasks.email import send_queued_emails

    return send_queued_emails.apply().get()


@pytest.fixture(autouse=True)
def empty_outbox(database, db_exec):
    """Each test starts with nothing queued and nothing 'sent'."""
    db_exec("UPDATE email_outbox SET status = 'skipped', body_encrypted = NULL WHERE status = 'queued'")
    mailer.SENT.clear()
    yield
    mailer.SENT.clear()


def _to(address: str) -> list:
    return [m for m in mailer.SENT if m.to_email == address]


# ── Managers ───────────────────────────────────────────────────────────
def test_assigned_manager_is_emailed_and_can_switch_it_off(api, db_exec):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    assert submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id).status_code == 200
    assert _send()["sent"] == 1
    [mail] = _to(t.priya.email)
    assert mail.kind == "approval_assigned" and "Wanda Writer asked you to approve" in mail.subject
    assert f"/posts/{post_id}" in mail.text and "needed by" in mail.text and "Sunrise Bakery" in mail.text
    assert "Turn them off in Settings" in mail.text
    # Nothing readable stays in the database once it is sent.
    row = db_exec("SELECT status::text, body_encrypted, attempts FROM email_outbox WHERE post_id = :p",
                  p=post_id).one()
    assert row.status == "sent" and row.body_encrypted is None and row.attempts == 1
    assert _send()["sent"] == 0      # and it is never sent twice

    # "Email me about approvals" off: the bell still works, the email stops.
    r = api.patch(f"{API}/auth/me", json={"email_notifications": False}, headers=t.priya.headers)
    assert r.status_code == 200 and r.json()["email_notifications"] is False
    second = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, second, assign_to_user_id=t.priya.user_id)
    mailer.SENT.clear()
    _send()
    assert _to(t.priya.email) == []
    notes = api.get(f"{API}/workspaces/{t.ws}/notifications", headers=t.priya.headers).json()["items"]
    assert any(n["post_id"] == second and n["type"] == "assigned" for n in notes)


def test_plan_without_email_sends_nothing(api, db_exec):
    t = team(api)
    set_override(db_exec, t.owner, "email_notifications", enabled=False)
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id)
    _set_round(db_exec, post_id, due_in_hours=-1)
    _run_reminders()
    _send()
    assert _to(t.priya.email) == []
    assert db_exec("SELECT count(*) FROM email_outbox WHERE workspace_id = :w", w=t.ws).scalar() == 0
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"email_client_reminders": True}, headers=t.owner.headers)
    assert_blocked(r, "feature_disabled", "email_notifications")
    options = api.get(f"{API}/workspaces/{t.ws}/approval-deadline-options", headers=t.owner.headers).json()
    assert options["email_enabled"] is False


# ── Clients ────────────────────────────────────────────────────────────
def test_client_reminder_email_and_opt_out(api, db_exec):
    t = team(api)
    cid = contact(api, t, email="ramesh@client.example")
    # Writing to clients is the agency's decision: off by default, managers only.
    assert api.get(f"{API}/workspaces", headers=t.owner.headers).json()[0]["email_client_reminders"] is False
    assert api.patch(f"{API}/workspaces/{t.ws}", json={"email_client_reminders": True},
                     headers=t.writer.headers).status_code == 403
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"email_client_reminders": True}, headers=t.priya.headers)
    assert r.status_code == 200 and r.json()["email_client_reminders"] is True

    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_contact_id=cid, due_tz="Asia/Kolkata")
    _set_round(db_exec, post_id, due_in_hours=4)
    _run_reminders()
    _send()
    [to_client] = _to("ramesh@client.example")
    assert to_client.kind == "client_reminder" and to_client.reply_to == t.writer.email
    assert "Hi Ramesh" in to_client.text and "@" not in to_client.text   # no team addresses in the body
    assert "IST" in to_client.text and "Wanda Writer sent you" in to_client.text
    assert "/a#" not in to_client.text          # the approval link is never repeated
    [to_sharer] = _to(t.writer.email)
    assert to_sharer.kind == "approval_due_soon"
    rows = api.get(f"{API}/posts/{post_id}/reminders", headers=t.writer.headers).json()
    assert [(r["stage"], r["channel"]) for r in rows] == [("due_soon", "email")]

    # The client stops the reminders from the email.
    token = re.search(r"/email/stop#(\S+)", to_client.text).group(1)
    assert api.post(f"{API}/public/email/stop", json={"token": token[:-2] + "zz"}).status_code == 404
    stop = api.post(f"{API}/public/email/stop", json={"token": token})
    assert stop.status_code == 200, stop.text
    assert stop.json()["stopped"] is True and stop.json()["brand_name"] == "Sunrise Bakery"
    assert stop.json()["agency_name"] and "@" not in stop.text
    assert api.post(f"{API}/public/email/stop", json={"token": token}).status_code == 200   # idempotent
    saved = api.get(f"{API}/brands/{t.brand_id}/contacts", headers=t.owner.headers).json()
    assert saved[0]["email_opted_out"] is True

    mailer.SENT.clear()
    _set_round(db_exec, post_id, due_in_hours=-1)
    _run_reminders()
    _send()
    assert _to("ramesh@client.example") == []
    assert len(_to(t.writer.email)) == 1         # the sharer still hears about it
    rows = api.get(f"{API}/posts/{post_id}/reminders", headers=t.writer.headers).json()
    assert {(r["stage"], r["channel"]) for r in rows} == {("due_soon", "email"), ("overdue", "in_app")}


def test_client_is_not_emailed_without_the_switch_or_a_working_link(api, db_exec):
    t = team(api)
    cid = contact(api, t, email="ramesh@client.example")
    first = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, first, assign_to_contact_id=cid)
    _set_round(db_exec, first, due_in_hours=4)
    _run_reminders()
    _send()
    assert _to("ramesh@client.example") == []    # switch is off

    api.patch(f"{API}/workspaces/{t.ws}", json={"email_client_reminders": True}, headers=t.owner.headers)
    second = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, second, assign_to_contact_id=cid)
    db_exec("UPDATE approval_links SET expires_at = now() - interval '1 minute' WHERE post_id = :p", p=second)
    _set_round(db_exec, second, due_in_hours=4)
    _run_reminders()
    _send()
    assert _to("ramesh@client.example") == []    # their link no longer works
    assert _post(api, t.writer, second)["status"] == "pending_approval"


# ── Forgot password ────────────────────────────────────────────────────
def test_forgot_password_by_email(api, db_exec):
    user = register(api, "Fiona Forgetful")
    same = api.post(f"{API}/auth/forgot-password", json={"email": "nobody-here@example.com"})
    r = api.post(f"{API}/auth/forgot-password", json={"email": user.email.upper()})
    assert r.status_code == same.status_code == 200 and r.json() == same.json()   # no hint who has an account
    _send()
    [mail] = _to(user.email)
    assert mail.kind == "password_reset" and len(mailer.SENT) == 1
    token = re.search(r"/set-password\?token=(\S+)", mail.text).group(1)
    row = db_exec("SELECT status::text, body_encrypted FROM email_outbox WHERE kind = 'password_reset' "
                  "AND to_email = :e", e=user.email).one()
    assert row.status == "sent" and row.body_encrypted is None

    done = api.post(f"{API}/auth/set-password", json={"token": token, "password": "a-brand-new-password-1"})
    assert done.status_code == 200, done.text
    assert api.post(f"{API}/auth/login", json={"email": user.email, "password": "password123"}).status_code == 401
    assert api.post(f"{API}/auth/login",
                    json={"email": user.email, "password": "a-brand-new-password-1"}).status_code == 200
    # The link works once.
    assert api.post(f"{API}/auth/set-password",
                    json={"token": token, "password": "another-password-22"}).status_code == 400

    # At most three emails per address per hour, whatever is asked.
    mailer.SENT.clear()
    for _ in range(5):
        assert api.post(f"{API}/auth/forgot-password", json={"email": user.email}).status_code == 200
    _send()
    assert len(_to(user.email)) == 2             # 1 earlier + 2 = 3 this hour


# ── Delivery ───────────────────────────────────────────────────────────
def test_failed_sends_retry_then_give_up_and_daily_cap(api, db_exec, monkeypatch):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id)

    def broken(_out):
        raise ConnectionRefusedError("smtp down: user=secret")

    monkeypatch.setattr(mailer, "deliver", broken)
    assert _send()["retry"] == 1 and _send()["retry"] == 1
    assert _send()["failed"] == 1
    row = db_exec("SELECT status::text, attempts, last_error, body_encrypted FROM email_outbox "
                  "WHERE post_id = :p", p=post_id).one()
    assert (row.status, row.attempts, row.last_error, row.body_encrypted) == \
        ("failed", 3, "ConnectionRefusedError", None)        # no error text that could hold secrets
    monkeypatch.undo()

    # Daily cap per workspace: the rest are skipped, not queued forever.
    _set_setting(db_exec, "max_emails_per_workspace_per_day", 10)
    try:
        from app.db.session import worker_session

        with worker_session() as db:
            for i in range(12):
                mailer.queue(db, kind="approval_assigned", to=mailer.Recipient(f"m{i}@example.com", "M"),
                             subject="s", text="t", workspace_id=uuid.UUID(t.ws))
        counts = _send()
        assert counts["sent"] == 10 and counts["skipped"] == 2
    finally:
        _set_setting(db_exec, "max_emails_per_workspace_per_day", 200)


def test_my_email_preference_is_mine_only(api):
    user = register(api, "Private Person")
    assert api.get(f"{API}/auth/me", headers=user.headers).json()["email_notifications"] is True
    assert api.patch(f"{API}/auth/me", json={"email_notifications": None}, headers=user.headers).status_code == 422
    assert api.patch(f"{API}/auth/me", json={"email_notifications": False}).status_code in (401, 403)
