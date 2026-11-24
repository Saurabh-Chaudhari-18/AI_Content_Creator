"""Approval deadlines, reminders and approval certificates
(docs/approval_reminders_certificate_plan.md §5)."""
from datetime import datetime, timedelta, timezone

from .conftest import register, run_job
from .test_client_approvals import (
    API, Team, contact, decide, draft, history, notes, submit, team, token_of, view,
)
from .test_plan_features import assert_blocked, set_override
from .test_publishing import make_account, publish_now


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _post(api, actor, post_id) -> dict:
    return api.get(f"{API}/posts/{post_id}", headers=actor.headers).json()


def _run_reminders() -> dict:
    from app.workers.tasks.approvals import send_approval_reminders

    return send_approval_reminders.apply().get()


def _set_round(db_exec, post_id, *, due_in_hours: float, submitted_hours_ago: float = 72) -> None:
    """Move a review round in time: when it was submitted and when it is due."""
    db_exec("UPDATE posts SET approval_due_at = now() + make_interval(secs => :due) WHERE id = :id",
            id=post_id, due=due_in_hours * 3600)
    db_exec("UPDATE approval_logs SET created_at = now() - make_interval(secs => :ago) "
            "WHERE post_id = :id AND action = 'submitted'", id=post_id, ago=submitted_hours_ago * 3600)


def _types_for(api, actor, ws, post_id) -> list[str]:
    return [n["type"] for n in notes(api, actor, ws) if n["post_id"] == post_id]


def _approve(api, t: Team, post_id) -> None:
    r = api.post(f"{API}/posts/{post_id}/approve", headers=t.priya.headers)
    assert r.status_code == 200, r.text


# ── Deadlines on submit ────────────────────────────────────────────────
def test_submit_sets_default_and_chosen_deadline(api):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    before = _now()
    assert submit(api, t.writer, post_id).status_code == 200
    due = datetime.fromisoformat(_post(api, t.writer, post_id)["approval_due_at"])
    assert timedelta(hours=47, minutes=58) < due - before < timedelta(hours=48, minutes=2)
    submitted = next(h for h in history(api, t.writer, post_id) if h["action"] == "submitted")
    assert datetime.fromisoformat(submitted["due_at"]) == due

    # Brand default beats the platform default.
    r = api.patch(f"{API}/brands/{t.brand_id}", json={"approval_due_hours": 6}, headers=t.owner.headers)
    assert r.status_code == 200 and r.json()["approval_due_hours"] == 6
    second = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, second)
    due = datetime.fromisoformat(_post(api, t.writer, second)["approval_due_at"])
    assert timedelta(hours=5, minutes=58) < due - _now() < timedelta(hours=6, minutes=2)

    # A chosen deadline, with the submitter's zone for reminder wording.
    third = draft(api, t.writer, t.brand_id)
    chosen = (_now() + timedelta(days=3)).replace(microsecond=0)
    r = submit(api, t.writer, third, due_at=chosen.isoformat(), due_tz="Asia/Kolkata")
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["approval_due_at"]) == chosen
    assert r.json()["approval_due_tz"] == "Asia/Kolkata"


def test_deadline_range_and_who_sets_defaults(api):
    t = team(api)
    for when in (_now() + timedelta(minutes=20), _now() + timedelta(days=20), _now() - timedelta(hours=1)):
        post_id = draft(api, t.writer, t.brand_id)
        r = submit(api, t.writer, post_id, due_at=when.isoformat())
        assert r.status_code == 400, r.text
        assert _post(api, t.writer, post_id)["status"] == "draft"
    # An unknown zone is ignored, never stored.
    post_id = draft(api, t.writer, t.brand_id)
    r = submit(api, t.writer, post_id, due_tz="Mars/Olympus")
    assert r.status_code == 200 and r.json()["approval_due_tz"] is None

    # Brand approval rules: owners and managers only, inside the platform range.
    r = api.patch(f"{API}/brands/{t.brand_id}", json={"approval_due_hours": 6}, headers=t.writer.headers)
    assert r.status_code == 403
    r = api.patch(f"{API}/brands/{t.brand_id}", json={"approval_due_hours": 5000}, headers=t.priya.headers)
    assert r.status_code == 400
    # Members still edit everything else on the brand.
    assert api.patch(f"{API}/brands/{t.brand_id}", json={"tone_of_voice": "warm"},
                     headers=t.writer.headers).status_code == 200

    r = api.patch(f"{API}/workspaces/{t.ws}", json={"approval_due_default_hours": 9999}, headers=t.owner.headers)
    assert r.status_code == 400
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"approval_due_default_hours": 24}, headers=t.priya.headers)
    assert r.status_code == 200 and r.json()["approval_due_default_hours"] == 24
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"approval_due_default_hours": 0}, headers=t.owner.headers)
    assert r.json()["approval_due_default_hours"] is None


def test_overdue_filter(api, db_exec):
    t = team(api)
    late, on_time = draft(api, t.writer, t.brand_id), draft(api, t.writer, t.brand_id)
    submit(api, t.writer, late)
    submit(api, t.writer, on_time)
    _set_round(db_exec, late, due_in_hours=-2)
    r = api.get(f"{API}/workspaces/{t.ws}/posts", params={"overdue": "true"}, headers=t.owner.headers)
    ids = [p["id"] for p in r.json()["items"]]
    assert late in ids and on_time not in ids and r.json()["total"] == 1


# ── Reminder job ───────────────────────────────────────────────────────
def test_manager_reminders_each_stage_once_then_escalate(api, db_exec):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id, due_tz="Asia/Kolkata")

    _set_round(db_exec, post_id, due_in_hours=5)
    _run_reminders()
    _run_reminders()   # nothing twice
    assert _types_for(api, t.priya, t.ws, post_id).count("approval_due_soon") == 1
    message = next(n["message"] for n in notes(api, t.priya, t.ws) if n["type"] == "approval_due_soon")
    assert "IST" in message
    assert "approval_due_soon" not in _types_for(api, t.amit, t.ws, post_id)

    _set_round(db_exec, post_id, due_in_hours=-1)
    _run_reminders()
    assert "approval_overdue" in _types_for(api, t.priya, t.ws, post_id)

    _set_round(db_exec, post_id, due_in_hours=-30)   # 24 h escalation delay passed
    _run_reminders()
    _run_reminders()
    for person in (t.owner, t.priya, t.amit, t.writer):
        assert _types_for(api, person, t.ws, post_id).count("approval_escalated") == 1
    # Without the brand switch the assignee stays.
    assert _post(api, t.writer, post_id)["assigned_approver_id"] == t.priya.user_id

    rows = api.get(f"{API}/posts/{post_id}/reminders", headers=t.writer.headers).json()
    assert sorted(r["stage"] for r in rows) == ["due_soon", "escalated", "overdue"]
    assert all(r["channel"] == "in_app" and r["created_by"] is None for r in rows)


def test_short_round_skips_due_soon_and_decided_posts_stop(api, db_exec):
    t = team(api)
    short = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, short, assign_to_user_id=t.priya.user_id)
    _set_round(db_exec, short, due_in_hours=2, submitted_hours_ago=1)   # a 3-hour round
    _run_reminders()
    assert _types_for(api, t.priya, t.ws, short) == ["assigned"]

    decided = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, decided, assign_to_user_id=t.priya.user_id)
    _approve(api, t, decided)
    _set_round(db_exec, decided, due_in_hours=-1)
    _run_reminders()
    assert "approval_overdue" not in _types_for(api, t.priya, t.ws, decided)


def test_client_reminders_go_to_the_sharer_and_overdue_release(api, db_exec):
    t = team(api)
    cid = contact(api, t)
    r = api.patch(f"{API}/brands/{t.brand_id}", json={"approval_release_when_overdue": True},
                  headers=t.owner.headers)
    assert r.status_code == 200 and r.json()["approval_release_when_overdue"] is True
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_contact_id=cid)

    _set_round(db_exec, post_id, due_in_hours=4)
    _run_reminders()
    sharer = next(n for n in notes(api, t.writer, t.ws) if n["type"] == "approval_due_soon")
    assert "Ramesh Patel" in sharer["message"] and "haven't opened" in sharer["message"]
    assert "approval_due_soon" not in _types_for(api, t.priya, t.ws, post_id)

    _set_round(db_exec, post_id, due_in_hours=-48)
    _run_reminders()
    post = _post(api, t.writer, post_id)
    assert post["assigned_contact_id"] is None and post["status"] == "pending_approval"
    moved = next(h for h in history(api, t.writer, post_id) if h["action"] == "reassigned")
    assert "didn't answer by the deadline" in moved["rejection_reason"]
    assert "approval_escalated" in _types_for(api, t.amit, t.ws, post_id)


def test_feature_off_means_no_deadlines(api, db_exec):
    t = team(api)
    set_override(db_exec, t.owner, "approval_reminders", enabled=False)
    post_id = draft(api, t.writer, t.brand_id)
    r = submit(api, t.writer, post_id, due_at=(_now() + timedelta(days=2)).isoformat())
    assert_blocked(r, "feature_disabled", "approval_reminders")
    r = submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id)
    assert r.status_code == 200 and r.json()["approval_due_at"] is None
    assert_blocked(api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "whatsapp"},
                            headers=t.writer.headers), "feature_disabled", "approval_reminders")

    # Even with a deadline set by hand, a switched-off workspace gets no reminders.
    _set_round(db_exec, post_id, due_in_hours=-1)
    _run_reminders()
    assert "approval_overdue" not in _types_for(api, t.priya, t.ws, post_id)


# ── Manual nudge ───────────────────────────────────────────────────────
def test_manual_nudge_permissions_dedupe_and_tenancy(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.owner, t.brand_id)
    submit(api, t.owner, post_id, assign_to_contact_id=cid)

    first = api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "whatsapp"}, headers=t.owner.headers)
    assert first.status_code == 201, first.text
    assert first.json()["stage"] == "manual_nudge" and first.json()["recipient_name"] == "Ramesh Patel"
    again = api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "email"}, headers=t.owner.headers)
    assert again.json()["id"] == first.json()["id"]          # two taps, one reminder

    # A member who neither wrote nor shared it may not chase it.
    r = api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "whatsapp"}, headers=t.writer.headers)
    assert r.status_code == 403
    assert api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "sms"},
                    headers=t.owner.headers).status_code == 422
    stranger = register(api, "Someone Else")
    assert api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "whatsapp"},
                    headers=stranger.headers).status_code == 404
    assert api.get(f"{API}/posts/{post_id}/reminders", headers=stranger.headers).status_code == 404

    _approve(api, t, post_id)
    r = api.post(f"{API}/posts/{post_id}/reminders", json={"channel": "whatsapp"}, headers=t.owner.headers)
    assert r.status_code == 400


# ── Certificates ───────────────────────────────────────────────────────
def test_manager_certificate_verify_and_publish_outcome(api):
    t = team(api)
    acct = make_account(api, t.owner, "facebook")
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id)
    _approve(api, t, post_id)

    r = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers)
    assert r.status_code == 200, r.text
    cert = r.json()
    post = _post(api, t.writer, post_id)
    assert cert["status"] == "current" and cert["fingerprint"] == post["content_hash"]
    assert len(cert["id"]) == 14 and cert["id"].count("-") == 2
    assert cert["approval"]["approver"] == {"name": "Priya Shah", "kind": "manager", "role": "admin"}
    assert cert["approval"]["submitted_by"] == "Wanda Writer" and cert["approval"]["due_at"]
    assert cert["approval"]["acted_by_assignee"] is True and cert["approval"]["backfilled"] is False
    assert [s["action"] for s in cert["trail"]] == ["submitted", "approved"]
    assert cert["content"]["platforms"][0]["platform"] == "facebook"
    assert "Diwali offer" in cert["content"]["platforms"][0]["text"]
    assert cert["published"] == []

    jobs = publish_now(api, t.owner, post_id, [acct["id"]])
    run_job(jobs[acct["id"]])
    published = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()["published"]
    assert len(published) == 1 and published[0]["status"] == "completed"
    assert published[0]["matched_fingerprint"] is True

    # Public check: minimal facts, any spelling of the number.
    public = api.get(f"{API}/public/certificates/{cert['id'].lower().replace('-', ' ')}")
    assert public.status_code == 200, public.text
    body = public.json()
    assert body["valid"] and body["id"] == cert["id"] and body["approved_by"] == "Priya Shah"
    assert body["brand_name"] == "Sunrise Bakery" and body["fingerprint"] == cert["fingerprint"]
    assert body["published"][0]["platform"] == "facebook" and "url" not in body["published"][0]
    assert "Diwali" not in public.text and "@" not in public.text
    assert public.headers["cache-control"] == "no-store"


def test_reapproval_supersedes_and_certificate_survives_deletion(api):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id)
    _approve(api, t, post_id)
    first = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()

    api.patch(f"{API}/posts/{post_id}", json={"caption": "Diwali offer: 25% off"}, headers=t.writer.headers)
    old = api.get(f"{API}/certificates/{first['id']}", headers=t.writer.headers).json()
    assert old["status"] == "superseded" and old["superseded_by"] is None
    submit(api, t.writer, post_id)
    _approve(api, t, post_id)
    second = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()
    assert second["id"] != first["id"] and second["status"] == "current"
    assert api.get(f"{API}/certificates/{first['id']}",
                   headers=t.writer.headers).json()["superseded_by"] == second["id"]
    assert [s["action"] for s in second["trail"]] == ["submitted", "approved", "invalidated", "submitted",
                                                      "approved"]

    assert api.delete(f"{API}/posts/{post_id}", headers=t.owner.headers).status_code == 200
    gone = api.get(f"{API}/certificates/{second['id']}", headers=t.writer.headers)
    assert gone.status_code == 200, gone.text
    assert gone.json()["status"] == "post_deleted" and gone.json()["post_id"] is None
    assert gone.json()["content"]["caption"] == "Diwali offer: 25% off"
    assert api.get(f"{API}/public/certificates/{second['id']}").json()["status"] == "post_deleted"


def test_client_approval_certificate_and_receipt(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    link = submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]
    token = token_of(link["url"])
    view(api, token)
    d = decide(api, token, "approve", name="Ramesh P.")
    assert d.status_code == 200, d.text
    receipt_id = d.json()["certificate_id"]
    assert receipt_id and view(api, token).json()["receipt"]["certificate_id"] == receipt_id

    cert = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()
    assert cert["id"] == receipt_id
    assert cert["approval"]["approver"]["kind"] == "client" and cert["approval"]["approver"]["name"] == "Ramesh P."
    facts = cert["approval"]["link"]
    assert facts["recipient_name"] == "Ramesh Patel" and facts["sent_by"] == "Wanda Writer"
    assert facts["first_viewed_at"] and facts["decided_at"]
    assert api.get(f"{API}/public/certificates/{receipt_id}").json()["approver_kind"] == "client"

    # Requesting changes produces no certificate.
    other = draft(api, t.writer, t.brand_id)
    token2 = token_of(submit(api, t.writer, other, assign_to_contact_id=cid).json()["approval_link"]["url"])
    d2 = decide(api, token2, "request_changes", note="Bigger logo please")
    assert d2.status_code == 200 and d2.json()["certificate_id"] is None
    assert api.get(f"{API}/posts/{other}/certificate", headers=t.writer.headers).status_code == 404


def test_certificate_tenancy_verification_switch_and_backfill(api, db_exec):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    submit(api, t.writer, post_id)
    _approve(api, t, post_id)
    cert_id = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()["id"]

    stranger = register(api, "Someone Else")
    assert api.get(f"{API}/posts/{post_id}/certificate", headers=stranger.headers).status_code == 404
    assert api.get(f"{API}/certificates/{cert_id}", headers=stranger.headers).status_code == 404
    for bad in ("NOPE", "AAAA-AAAA-AAAA", "0000-0000-0000"):
        assert api.get(f"{API}/public/certificates/{bad}").status_code == 404

    # Only the owner decides whether outsiders can check certificates.
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"certificate_verification_enabled": False},
                  headers=t.priya.headers)
    assert r.status_code == 403
    r = api.patch(f"{API}/workspaces/{t.ws}", json={"certificate_verification_enabled": False},
                  headers=t.owner.headers)
    assert r.status_code == 200 and r.json()["certificate_verification_enabled"] is False
    assert api.get(f"{API}/public/certificates/{cert_id}").status_code == 404
    assert api.get(f"{API}/posts/{post_id}/certificate",
                   headers=t.writer.headers).json()["verification_enabled"] is False

    # A post approved before certificates existed gets one on first view.
    db_exec("DELETE FROM approval_certificates WHERE post_id = :id", id=post_id)
    again = api.get(f"{API}/posts/{post_id}/certificate", headers=t.writer.headers).json()
    assert again["approval"]["backfilled"] is True and again["id"] != cert_id
    assert again["status"] == "current"
    # A draft has none.
    fresh = draft(api, t.writer, t.brand_id)
    assert api.get(f"{API}/posts/{fresh}/certificate", headers=t.writer.headers).status_code == 404


def test_deadline_options_follow_brand_and_plan(api, db_exec):
    t = team(api)
    url = f"{API}/workspaces/{t.ws}/approval-deadline-options"
    body = api.get(url, headers=t.writer.headers).json()
    assert body["enabled"] is True and body["default_hours"] == 48 and body["min_hours"] == 1
    api.patch(f"{API}/brands/{t.brand_id}", json={"approval_due_hours": 6, "approval_escalate_after_hours": 2},
              headers=t.owner.headers)
    body = api.get(url, params={"brand_id": t.brand_id}, headers=t.writer.headers).json()
    assert body["default_hours"] == 6 and body["escalate_after_hours"] == 2
    stranger = register(api, "Someone Else")
    assert api.get(url, headers=stranger.headers).status_code == 404
    other_brand = api.post(f"{API}/workspaces/{stranger.workspace_id}/brands", json={"name": "Theirs"},
                           headers=stranger.headers).json()["id"]
    assert api.get(url, params={"brand_id": other_brand}, headers=t.writer.headers).status_code == 404
    set_override(db_exec, t.owner, "approval_reminders", enabled=False)
    assert api.get(url, headers=t.writer.headers).json()["enabled"] is False
