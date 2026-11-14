"""Approver picker, client approval links, notifications and the admin
views (docs/client_approval_link_plan.md §9)."""
import uuid
from dataclasses import dataclass

import pytest

from .conftest import Actor, register, run_job
from .test_plan_features import add_member, assert_blocked, set_override
from .test_publishing import make_account, publish_now

API = "/api/v1"
ADMIN = "/api/v1/admin"
WHY = {"reason": "integration test"}


@pytest.fixture(autouse=True)
def generous_public_limit(db_exec):
    """Many public calls come from one test IP; the default 30/min is real-world."""
    _set_setting(db_exec, "public_approval_requests_per_minute_per_ip", 300)
    yield


def _set_setting(db_exec, key, value):
    db_exec(
        "INSERT INTO platform_settings (key, value, value_type, description) "
        "VALUES (:k, to_jsonb(CAST(:v AS integer)), 'integer', '') "
        "ON CONFLICT (key) DO UPDATE SET value = to_jsonb(CAST(:v AS integer))",
        k=key, v=value,
    )


@dataclass
class Team:
    owner: Actor
    priya: Actor     # admin ("Manager")
    amit: Actor      # admin ("Manager")
    writer: Actor    # member
    ws: str
    brand_id: str


def team(api) -> Team:
    owner = register(api, "Olivia Owner")
    priya, amit, writer = register(api, "Priya Shah"), register(api, "Amit Rao"), register(api, "Wanda Writer")
    for person, role in ((priya, "admin"), (amit, "admin"), (writer, "member")):
        assert add_member(api, owner, person, role).status_code == 200
    brand = api.post(f"{API}/workspaces/{owner.workspace_id}/brands", json={"name": "Sunrise Bakery"},
                     headers=owner.headers).json()
    return Team(owner, priya, amit, writer, owner.workspace_id, brand["id"])


def draft(api, actor, brand_id, caption="Diwali offer: 20% off all sweets") -> str:
    r = api.post(f"{API}/brands/{brand_id}/posts", json={"caption": caption, "title": "Diwali offer"},
                 headers=actor.headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def contact(api, t: Team, name="Ramesh Patel", phone="+91 98765 43210", **extra) -> str:
    r = api.post(f"{API}/brands/{t.brand_id}/contacts", json={"name": name, "phone": phone, **extra},
                 headers=t.owner.headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def submit(api, actor, post_id, **choice):
    return api.post(f"{API}/posts/{post_id}/submit", json=choice or None, headers=actor.headers)


def token_of(url: str) -> str:
    assert "/a#" in url
    return url.split("#", 1)[1]


def view(api, token):
    return api.post(f"{API}/public/approval/view", json={"token": token})


def decide(api, token, decision="approve", name="Ramesh Patel", note=None):
    return api.post(f"{API}/public/approval/decide",
                    json={"token": token, "decision": decision, "name": name, "note": note})


def history(api, actor, post_id):
    return api.get(f"{API}/posts/{post_id}/history", headers=actor.headers).json()


def notes(api, actor, ws):
    return api.get(f"{API}/workspaces/{ws}/notifications", headers=actor.headers).json()["items"]


def status_of(api, actor, post_id):
    return api.get(f"{API}/posts/{post_id}", headers=actor.headers).json()["status"]


# ── Picker & "any manager can approve" ────────────────────────────────
def test_picker_lists_managers_and_contacts(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.owner, t.brand_id)
    r = api.get(f"{API}/posts/{post_id}/approvers", headers=t.writer.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    names = {m["name"] for m in body["managers"]}
    # The author (owner) is left out: self-approval switched off when the team grew.
    assert names == {"Priya Shah", "Amit Rao"}
    assert [c["contact_id"] for c in body["contacts"]] == [cid]
    assert body["can_add_contacts"] is False          # a member can't add contacts
    assert api.get(f"{API}/posts/{post_id}/approvers", headers=t.owner.headers).json()["can_add_contacts"]


def test_assigned_manager_and_on_behalf_record(api):
    t = team(api)
    post_id = draft(api, t.writer, t.brand_id)
    r = submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id)
    assert r.status_code == 200, r.text
    assert r.json()["assigned_name"] == "Priya Shah" and r.json()["approval_link"] is None

    # Priya is notified and sees it in "Waiting for my approval".
    assert any(n["type"] == "assigned" and n["post_id"] == post_id for n in notes(api, t.priya, t.ws))
    mine = api.get(f"{API}/workspaces/{t.ws}/posts", params={"assigned_to": "me"}, headers=t.priya.headers).json()
    assert [p["id"] for p in mine["items"]] == [post_id]
    assert api.get(f"{API}/workspaces/{t.ws}/posts", params={"assigned_to": "me"},
                   headers=t.amit.headers).json()["total"] == 0

    # Amit approves in Priya's place: allowed, and recorded as such.
    assert api.post(f"{API}/posts/{post_id}/approve", headers=t.amit.headers).status_code == 200
    approved = next(h for h in history(api, t.writer, post_id) if h["action"] == "approved")
    assert approved["user_id"] == t.amit.user_id
    assert approved["assigned_name"] == "Priya Shah" and approved["acted_by_assignee"] is False
    submitted = next(h for h in history(api, t.writer, post_id) if h["action"] == "submitted")
    assert submitted["assigned_user_id"] == t.priya.user_id

    # Priya can no longer act; the assignee is cleared; both are told.
    assert api.post(f"{API}/posts/{post_id}/approve", headers=t.priya.headers).status_code == 400
    post = api.get(f"{API}/posts/{post_id}", headers=t.writer.headers).json()
    assert post["assigned_name"] is None
    msg = next(n for n in notes(api, t.writer, t.ws) if n["type"] == "manager_approved")
    assert "on Priya Shah's behalf" in msg["message"]
    assert any(n["type"] == "manager_approved" for n in notes(api, t.priya, t.ws))
    assert not any(n["type"] == "manager_approved" for n in notes(api, t.amit, t.ws))  # never the actor


def test_assignee_validation_and_reassign(api):
    t = team(api)
    other = register(api, "Outsider")
    post_id = draft(api, t.writer, t.brand_id)
    assert submit(api, t.writer, post_id, assign_to_user_id=other.user_id).status_code == 400
    assert submit(api, t.writer, post_id, assign_to_user_id=t.writer.user_id).status_code == 400  # a member
    assert submit(api, t.writer, post_id, assign_to_contact_id=str(uuid.uuid4())).status_code == 400
    # Another brand's contact is not available here.
    brand2 = api.post(f"{API}/workspaces/{t.ws}/brands", json={"name": "Other"}, headers=t.owner.headers).json()
    c2 = api.post(f"{API}/brands/{brand2['id']}/contacts", json={"name": "X", "email": "x@example.com"},
                  headers=t.owner.headers).json()["id"]
    assert submit(api, t.writer, post_id, assign_to_contact_id=c2).status_code == 400

    assert submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id).status_code == 200
    r = api.patch(f"{API}/posts/{post_id}/assignee", json={"assign_to_user_id": t.amit.user_id},
                  headers=t.writer.headers)
    assert r.status_code == 200 and r.json()["assigned_name"] == "Amit Rao"
    moved = next(h for h in history(api, t.writer, post_id) if h["action"] == "reassigned")
    assert moved["assigned_name"] == "Amit Rao" and "Priya Shah" in moved["rejection_reason"]
    assert api.post(f"{API}/posts/{post_id}/approve", headers=t.amit.headers).status_code == 200
    assert api.patch(f"{API}/posts/{post_id}/assignee", json={}, headers=t.writer.headers).status_code == 400


# ── Contacts ───────────────────────────────────────────────────────────
def test_contacts_permissions_validation_and_limit(api, db_exec):
    t = team(api)
    url = f"{API}/brands/{t.brand_id}/contacts"
    assert api.post(url, json={"name": "A", "phone": "+919800000000"}, headers=t.writer.headers).status_code == 403
    assert api.post(url, json={"name": "A"}, headers=t.owner.headers).status_code == 422          # no phone/email
    assert api.post(url, json={"name": "A", "phone": "98000"}, headers=t.owner.headers).status_code == 422
    cid = contact(api, t)
    assert api.get(url, headers=t.writer.headers).json()[0]["phone"] == "+919876543210"

    set_override(db_exec, t.owner, "max_client_contacts_per_brand", enabled=True, limit=1)
    assert_blocked(api.post(url, json={"name": "B", "email": "b@example.com"}, headers=t.owner.headers),
                   "limit_reached", "max_client_contacts_per_brand")
    r = api.patch(f"{url}/{cid}", json={"role_label": "Marketing head"}, headers=t.priya.headers)
    assert r.status_code == 200 and r.json()["role_label"] == "Marketing head"


# ── The client journey ─────────────────────────────────────────────────
def test_client_approves_then_post_publishes(api):
    t = team(api)
    acct = make_account(api, t.owner, "facebook")
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    r = submit(api, t.writer, post_id, assign_to_contact_id=cid)
    assert r.status_code == 200, r.text
    link = r.json()["approval_link"]
    assert link["recipient_phone"] == "+919876543210" and link["expiry_minutes"] == 10080
    token = token_of(link["url"])

    links = api.get(f"{API}/posts/{post_id}/approval-links", headers=t.writer.headers).json()
    assert links[0]["status"] == "not_opened" and "url" not in links[0] and "token" not in str(links[0])

    v = view(api, token)
    assert v.status_code == 200, v.text
    body = v.json()
    assert body["state"] == "open" and body["brand_name"] == "Sunrise Bakery" and body["version"] >= 1
    assert body["recipient_name"] == "Ramesh Patel" and body["server_now"]
    assert [p["platform"] for p in body["platforms"]] == ["facebook"]
    assert "Diwali offer" in body["platforms"][0]["text"]
    assert v.headers["cache-control"] == "no-store" and v.headers["referrer-policy"] == "no-referrer"
    assert "@" not in v.text   # no user emails leak
    assert api.get(f"{API}/posts/{post_id}/approval-links", headers=t.writer.headers).json()[0]["status"] == "opened"

    d = decide(api, token, "approve", name="Ramesh P.")
    assert d.status_code == 200, d.text
    assert d.json()["decision"] == "approved" and len(d.json()["fingerprint"]) == 12
    assert status_of(api, t.writer, post_id) == "approved"
    row = next(h for h in history(api, t.writer, post_id) if h["action"] == "approved")
    assert row["user_id"] is None and row["approval_link_id"] == link["id"]
    assert row["actor_name"] == "Ramesh P." and row["acted_by_assignee"] is True
    assert any(n["type"] == "client_approved" for n in notes(api, t.writer, t.ws))

    # A second tap answers with the client's own receipt, not a second decision.
    again = decide(api, token)
    assert again.status_code == 409 and again.json()["code"] == "already_decided"
    assert view(api, token).json()["receipt"]["decision"] == "approved"

    # The publish worker accepts a client approval unchanged.
    jobs = publish_now(api, t.owner, post_id, [acct["id"]])
    assert run_job(jobs[acct["id"]])["status"] in ("completed", "published")
    assert status_of(api, t.owner, post_id) == "published"


def test_request_changes_needs_note_and_resubmit_suggests_same_client(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    token = token_of(submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]["url"])
    assert decide(api, token, "request_changes").status_code == 422
    r = decide(api, token, "request_changes", note="Use the new logo")
    assert r.status_code == 200 and r.json()["decision"] == "changes_requested"
    assert status_of(api, t.writer, post_id) == "draft"
    rejected = next(h for h in history(api, t.writer, post_id) if h["action"] == "rejected")
    assert rejected["rejection_reason"] == "Use the new logo"
    assert any(n["type"] == "client_changes_requested" for n in notes(api, t.writer, t.ws))

    api.patch(f"{API}/posts/{post_id}", json={"caption": "Diwali offer, new logo"}, headers=t.writer.headers)
    suggested = api.get(f"{API}/posts/{post_id}/approvers", headers=t.writer.headers).json()["suggested"]
    assert suggested == {"kind": "contact", "id": cid, "name": "Ramesh Patel"}
    # The old link belongs to the old version.
    assert submit(api, t.writer, post_id, assign_to_contact_id=cid).status_code == 200
    assert view(api, token).json()["state"] == "already_decided"


def test_first_decision_wins(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    first = token_of(submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]["url"])
    r = api.post(f"{API}/posts/{post_id}/approval-links",
                 json={"recipient_name": "Neha Kapoor", "recipient_contact": "neha@example.com"},
                 headers=t.owner.headers)
    assert r.status_code == 201, r.text
    second = token_of(r.json()["url"])

    assert decide(api, first).status_code == 200
    v = view(api, second)
    assert v.json()["state"] == "already_reviewed" and v.json()["platforms"] == []
    assert "Ramesh" not in v.text          # never names the other reviewer
    late = decide(api, second, name="Neha Kapoor")
    assert late.status_code == 409 and late.json()["code"] == "already_reviewed"

    # A manager deciding first does the same to open links.
    post2 = draft(api, t.writer, t.brand_id, caption="Second post")
    tok = token_of(submit(api, t.writer, post2, assign_to_contact_id=cid).json()["approval_link"]["url"])
    assert api.post(f"{API}/posts/{post2}/approve", headers=t.amit.headers).status_code == 200
    assert decide(api, tok).json()["code"] == "already_reviewed"
    amit_row = next(h for h in history(api, t.writer, post2) if h["action"] == "approved")
    assert amit_row["assigned_name"] == "Ramesh Patel" and amit_row["acted_by_assignee"] is False


def test_member_can_only_share_with_saved_contacts(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    assert submit(api, t.writer, post_id).status_code == 200
    url = f"{API}/posts/{post_id}/approval-links"
    assert api.post(url, json={"recipient_name": "My friend", "recipient_contact": "+919811111111"},
                    headers=t.writer.headers).status_code == 403
    assert api.post(url, json={"contact_id": cid}, headers=t.writer.headers).status_code == 201
    # Drafts can't be shared.
    other = draft(api, t.writer, t.brand_id)
    assert api.post(f"{API}/posts/{other}/approval-links", json={"contact_id": cid},
                    headers=t.writer.headers).status_code == 400


# ── Lifetimes (D5) ─────────────────────────────────────────────────────
def test_expiry_levels_strict_deadline_and_resend(api, db_exec):
    t = team(api)
    cid = contact(api, t)
    ws_url = f"{API}/workspaces/{t.ws}"
    assert api.patch(ws_url, json={"approval_link_default_minutes": 1440}, headers=t.owner.headers).status_code == 200
    assert api.patch(ws_url, json={"approval_link_default_minutes": 1}, headers=t.owner.headers).status_code == 400

    opts = api.get(f"{API}/workspaces/{t.ws}/approval-link-options", headers=t.writer.headers).json()
    assert opts["default_minutes"] == 1440 and opts["max_for_you"] == 1440 and opts["presets"] == [15, 60, 1440]
    assert api.get(f"{API}/workspaces/{t.ws}/approval-link-options",
                   headers=t.owner.headers).json()["max_for_you"] == 43200

    post_id = draft(api, t.writer, t.brand_id)
    assert submit(api, t.writer, post_id, assign_to_contact_id=cid, expires_in_minutes=4320).status_code == 403
    assert submit(api, t.writer, post_id, assign_to_contact_id=cid, expires_in_minutes=5).status_code == 400
    r = submit(api, t.writer, post_id, assign_to_contact_id=cid, expires_in_minutes=15)
    assert r.status_code == 200 and r.json()["approval_link"]["expiry_minutes"] == 15
    link = r.json()["approval_link"]
    token = token_of(link["url"])
    assert view(api, token).json()["state"] == "open"

    # The deadline passes while the page is open: the server refuses.
    db_exec("UPDATE approval_links SET expires_at = now() - interval '1 second' WHERE id = :id", id=link["id"])
    late = decide(api, token)
    assert late.status_code == 410 and late.json()["code"] == "expired"
    assert status_of(api, t.writer, post_id) == "pending_approval"

    # The sharer is told once.
    from app.workers.tasks.approvals import notify_expired_links

    notify_expired_links.apply().get()
    notify_expired_links.apply().get()
    expired = [n for n in notes(api, t.writer, t.ws) if n["type"] == "link_expired" and n["post_id"] == post_id]
    assert len(expired) == 1

    listed = api.get(f"{API}/posts/{post_id}/approval-links", headers=t.writer.headers).json()[0]
    assert listed["status"] == "expired" and listed["can_resend"]
    again = api.post(f"{API}/approval-links/{link['id']}/resend", headers=t.writer.headers)
    assert again.status_code == 201 and again.json()["expiry_minutes"] == 15
    assert decide(api, token_of(again.json()["url"])).status_code == 200
    assert decide(api, token).status_code == 404   # the old link stays dead


def test_admin_expiry_settings_stay_ordered(api, db_exec):
    admin = register(api, "Platform Owner")
    db_exec("UPDATE users SET platform_role = 'super_admin' WHERE id = :id", id=admin.user_id)
    for key, value in (("approval_link_min_expiry_minutes", 15), ("approval_link_default_minutes", 10080),
                       ("approval_link_max_expiry_minutes", 43200)):
        _set_setting(db_exec, key, value)
    r = api.patch(f"{ADMIN}/settings/approval_link_max_expiry_minutes", json={"value": 5000, **WHY},
                  headers=admin.headers)   # below the 7-day default
    assert r.status_code == 400 and "ordered" in r.json()["detail"]
    assert api.patch(f"{ADMIN}/settings/approval_link_min_expiry_minutes", json={"value": 30, **WHY},
                     headers=admin.headers).status_code == 200
    _set_setting(db_exec, "approval_link_min_expiry_minutes", 15)


# ── Links that stop working ────────────────────────────────────────────
def test_links_stop_working(api, db_exec):
    t = team(api)
    cid = contact(api, t)

    def shared():
        pid = draft(api, t.writer, t.brand_id)
        return pid, token_of(submit(api, t.writer, pid, assign_to_contact_id=cid).json()["approval_link"]["url"])

    # Withdrawn to edit → "changed", not "already reviewed".
    pid, tok = shared()
    assert api.post(f"{API}/posts/{pid}/withdraw", headers=t.writer.headers).status_code == 200
    assert view(api, tok).json()["state"] == "changed"

    # Revoked → the same 404 as a made-up token.
    pid, tok = shared()
    link_id = api.get(f"{API}/posts/{pid}/approval-links", headers=t.writer.headers).json()[0]["id"]
    assert api.delete(f"{API}/approval-links/{link_id}", headers=t.writer.headers).status_code == 200
    assert view(api, tok).status_code == 404
    assert view(api, "x" * 43).json() == view(api, tok).json()

    # Feature switched off for the workspace → temporarily unavailable.
    pid, tok = shared()
    set_override(db_exec, t.owner, "client_approval_links", enabled=False)
    assert view(api, tok).json()["code"] == "unavailable"
    set_override(db_exec, t.owner, "client_approval_links", enabled=True)
    assert view(api, tok).json()["state"] == "open"

    # Brand deactivated → links revoked.
    assert api.delete(f"{API}/brands/{t.brand_id}", headers=t.owner.headers).status_code == 200
    assert view(api, tok).status_code == 404

    # Deleting a post deletes its links.
    t2 = team(api)
    c2 = contact(api, t2)
    p2 = draft(api, t2.writer, t2.brand_id)
    tok2 = token_of(submit(api, t2.writer, p2, assign_to_contact_id=c2).json()["approval_link"]["url"])
    assert api.delete(f"{API}/posts/{p2}", headers=t2.owner.headers).status_code == 200
    assert view(api, tok2).status_code == 404


# ── Fall-back (D12) ────────────────────────────────────────────────────
def test_removed_contact_releases_posts_and_revokes_links(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    token = token_of(submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]["url"])

    r = api.delete(f"{API}/brands/{t.brand_id}/contacts/{cid}", params={"forget": "true"}, headers=t.owner.headers)
    assert r.status_code == 200, r.text
    assert view(api, token).status_code == 404
    post = api.get(f"{API}/posts/{post_id}", headers=t.writer.headers).json()
    assert post["assigned_contact_id"] is None and post["status"] == "pending_approval"
    moved = next(h for h in history(api, t.writer, post_id) if h["action"] == "reassigned")
    assert moved["user_id"] is None and moved["actor_name"] == "System"
    assert any(n["type"] == "assignment_released" for n in notes(api, t.writer, t.ws))
    removed = api.get(f"{API}/brands/{t.brand_id}/contacts", params={"include_removed": "true"},
                      headers=t.owner.headers).json()[0]
    assert removed["forgotten"] and removed["phone"] is None and removed["name"] == "Ramesh Patel"
    sug = api.get(f"{API}/posts/{post_id}/approvers", headers=t.writer.headers).json()
    assert sug["suggested"] is None and "can no longer approve" in sug["suggestion_note"]


def test_admin_role_change_releases_assignment_via_sweep(api, db_exec):
    t = team(api)
    admin = register(api, "Platform Owner")
    db_exec("UPDATE users SET platform_role = 'super_admin' WHERE id = :id", id=admin.user_id)
    post_id = draft(api, t.writer, t.brand_id)
    assert submit(api, t.writer, post_id, assign_to_user_id=t.priya.user_id).status_code == 200

    r = api.patch(f"{ADMIN}/workspaces/{t.ws}/members/{t.priya.user_id}", json={"role": "member", **WHY},
                  headers=admin.headers)
    assert r.status_code == 200, r.text
    from app.workers.tasks.approvals import release_stale_assignments

    release_stale_assignments.apply().get()
    post = api.get(f"{API}/posts/{post_id}", headers=t.writer.headers).json()
    assert post["assigned_approver_id"] is None
    moved = next(h for h in history(api, t.writer, post_id) if h["action"] == "reassigned")
    assert "no longer a manager" in moved["rejection_reason"]
    # Any other manager can still approve.
    assert api.post(f"{API}/posts/{post_id}/approve", headers=t.amit.headers).status_code == 200


# ── Tenancy, notifications, rate limit ─────────────────────────────────
def test_tenancy_and_notification_privacy(api):
    t = team(api)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    link_id = submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]["id"]
    outsider = register(api, "Outsider")
    assert api.get(f"{API}/posts/{post_id}/approval-links", headers=outsider.headers).status_code == 404
    assert api.delete(f"{API}/approval-links/{link_id}", headers=outsider.headers).status_code == 404
    assert api.get(f"{API}/brands/{t.brand_id}/contacts", headers=outsider.headers).status_code == 404
    assert api.get(f"{API}/workspaces/{t.ws}/notifications", headers=outsider.headers).status_code == 404

    assert submit(api, t.writer, draft(api, t.writer, t.brand_id), assign_to_user_id=t.priya.user_id).status_code == 200
    priya_note = notes(api, t.priya, t.ws)[0]
    url = f"{API}/workspaces/{t.ws}/notifications/{priya_note['id']}/read"
    assert api.post(url, headers=t.amit.headers).status_code == 404       # not Amit's
    before = api.get(f"{API}/workspaces/{t.ws}/notifications/unread-count", headers=t.priya.headers).json()["unread"]
    assert api.post(url, headers=t.priya.headers).json()["unread"] == before - 1
    assert api.post(f"{API}/workspaces/{t.ws}/notifications/read-all", headers=t.priya.headers).json()["unread"] == 0


def test_public_rate_limit(api, db_exec):
    _set_setting(db_exec, "public_approval_requests_per_minute_per_ip", 5)
    try:
        codes = [view(api, "y" * 43).status_code for _ in range(8)]
        assert 429 in codes
    finally:
        _set_setting(db_exec, "public_approval_requests_per_minute_per_ip", 300)
        import redis

        import os
        r = redis.Redis.from_url(os.environ["REDIS_URL"])
        for key in r.scan_iter("rl:pub:ip:*"):
            r.delete(key)


# ── Super admin views (§7) ─────────────────────────────────────────────
def test_admin_sees_counts_not_client_details(api, db_exec):
    t = team(api)
    admin = register(api, "Platform Owner")
    db_exec("UPDATE users SET platform_role = 'super_admin' WHERE id = :id", id=admin.user_id)
    cid = contact(api, t)
    post_id = draft(api, t.writer, t.brand_id)
    token = token_of(submit(api, t.writer, post_id, assign_to_contact_id=cid).json()["approval_link"]["url"])
    view(api, token)
    assert decide(api, token).status_code == 200

    overview = api.get(f"{ADMIN}/overview", headers=admin.headers)
    assert overview.status_code == 200, overview.text
    assert overview.json()["client_approvals"]["links_created"] >= 1

    detail = api.get(f"{ADMIN}/workspaces/{t.ws}", headers=admin.headers)
    assert detail.status_code == 200, detail.text
    stats = detail.json()["approvals"]
    assert stats["links_created"] == 1 and stats["links_opened"] == 1 and stats["client_approved"] == 1
    assert stats["approvals_by_client"] == 1 and stats["saved_contacts"] == 1
    assert "Ramesh" not in detail.text and "98765" not in detail.text

    post_view = api.get(f"{ADMIN}/posts/{post_id}", headers=admin.headers)
    assert post_view.status_code == 200, post_view.text
    assert "Ramesh" not in post_view.text and "Client (via link)" in post_view.text

    # The admin database role can't read tokens or client contact details.
    for sql in ("SELECT token_hash FROM approval_links LIMIT 1",
                "SELECT phone FROM brand_contacts LIMIT 1",
                "SELECT message FROM notifications LIMIT 1"):
        with pytest.raises(Exception):
            db_exec(f"SET LOCAL ROLE omnipost_admin; {sql}")
