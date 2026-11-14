# Approver Picker & Client Approval Links — Full Plan

One plan covering everything that changes: **database, backend, the agency's app (users),
the client's approval page (clients), and the super admin panel.**

Status: **built 2026-11-14 (not yet committed).** See §12 for where the build differs from this plan.

---

## 0. Summary

| | |
|---|---|
| **What** | When a writer submits a post, they pick who should approve it from one list: **a manager** on their team, or **a saved client contact** for that brand. A manager approves inside the app. A client gets a **no-login link** (sent by WhatsApp, email or copy), sees the exact post on their phone, and taps **Approve** or **Request changes**. |
| **Why** | Clients are the biggest bottleneck for agencies, and buyers expect a login-free client link (most competitors have it). Our approvals are tied to the exact content, so every decision is provable. |
| **Running cost** | **Zero.** Links go out through the agency's own WhatsApp, email or clipboard. No WhatsApp Business API or email provider is needed. |
| **Pricing** | On for every plan at launch. The super admin can switch it per plan or per workspace and set plan limits without a code change. |
| **Effort** | **≈ 9.5 days** (section 10). |

---

## 1. Final decisions

| # | Decision |
|---|---|
| D1 | A **client's approval is final** (one step). It works exactly like a manager approving. A two-step "manager, then client" flow can be a per-brand setting later. |
| D2 | **One picker** on Submit: managers (Owner and Admin roles; "Admin" is shown as **Manager**) plus the brand's saved client contacts, plus "Any manager". |
| D3 | **Any manager can approve while the post is pending**, not only the assigned one. The permanent record states who it was assigned to, who acted, and whether that was the assignee ("Approved by Amit on Priya's behalf"). |
| D4 | **Owners and admins** can send a link to anyone and manage saved contacts. **Members** can send only to the brand's saved contacts and can't type a new number, so nobody can send a link to themselves to skip review. |
| D5 | **Link expiry is decided at three levels** (decided 2026-11-14): the **super admin** sets the allowed range for the whole platform (default **15 minutes to 30 days**); each **workspace** sets its default inside that range (default **7 days**); the **person sharing** picks a preset per link (15 min · 1 hour · 24 hours · 3 days · 7 days, showing only those in range). **Members can only shorten** the workspace default; owners and admins can choose anything within the platform range. The deadline is strict: a decision after expiry is refused, even if the page was opened in time. One decision per link; it can be viewed any number of times. |
| D6 | v1 has **Approve** and **Request changes (with a note)**. A free comment thread is a separate later feature. |
| D7 | The client sees **every platform** the post goes to (Instagram / Facebook / LinkedIn tabs). |
| D8 | The **super admin observes and controls switches only**. They never approve, share, revoke or edit inside a workspace, and never see client phone numbers or emails, or the links themselves. |
| D9 | **Several reviewers on one post: the first decision wins.** A post can have open links to several clients and be visible to managers at the same time. The first Approve or Request changes, from anyone, decides it; every other open link then shows *"This post has already been reviewed"* (without naming the other reviewer). "Everyone must approve" is a later feature. |
| D10 | **In-app notifications** (a bell with an unread count; no email or WhatsApp cost): *Assigned to you*, *Client approved*, *Changes requested*, *Approved by a manager*, *Link expired*, *Assignment moved to any manager*. |
| D11 | **Resubmitting goes back to the same reviewer by default.** After "Request changes", the Submit picker pre-selects the previous approver ("Send back to Ramesh"); it can still be changed. |
| D12 | **Assignee can no longer approve → falls back to "Any manager".** When the assigned manager is removed, has their role lowered, or their account is deactivated, or the assigned client contact is removed or forgotten, their pending posts move to "Any manager". Open links to a removed contact are revoked. Each change is written to the history and the author is notified. |
| D13 | **Brand deactivated or post deleted → links stop working.** A deactivated brand's links answer "not valid", its contacts drop out of the picker, and its pending posts can't be decided by link. Deleting a post deletes its links. |
| D14 | **Deadlines always show a time zone.** The WhatsApp or email text uses the sender's time zone with its label (*"by 4:30 pm IST, 15 Nov"*); the client page shows the deadline in the client's own time zone, with the label. |

---

## 2. End-to-end flow

```
WRITER                         MANAGER / CLIENT                        RESULT
──────                         ────────────────                        ──────
Draft ─► Submit for approval
         "Who should approve?"
          ├─ Priya (Manager) ──► Priya's "Waiting for my approval" ─┐
          │                      (any manager may act)              │
          ├─ Ramesh (Client) ──► link via WhatsApp / email / copy   │
          │                      Ramesh opens it on his phone ──────┤
          └─ Any manager ──────► shows for every manager ───────────┤
                                                                     ▼
                                 Approve ──────────────► post = approved ─► schedule / publish
                                 Request changes + note ► post = draft   ─► writer edits, resubmits
```

Rules that keep it safe:
- Links can be made only for **pending** posts. Pending posts are already locked for editing.
- Each link stores the **content hash and version at the moment it was shared**. It stops working
  once the post leaves pending (withdrawn, approved by a manager, rejected), the content changes,
  the link is revoked, or it expires.
- Every decision runs the **same checks as today's `approve_post`** (state, role or link, submitted
  hash = live hash). A client approval writes a normal `approved` row to the approval history, so
  the publish worker and Retry accept it with **no change**.

---

## 3. Database changes (migration `0007_approver_picker_client_links`)

### 3.1 New table `brand_contacts`: saved client approvers

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `brand_id` | UUID FK brands, cascade | indexed |
| `workspace_id` | UUID FK workspaces, cascade | indexed; used for tenancy and limits |
| `name` | varchar(120) | required |
| `role_label` | varchar(80) null | e.g. "Marketing head" |
| `phone` | varchar(20) null | E.164 format, for `wa.me` links |
| `email` | varchar(255) null | |
| `is_active` | bool, default true | soft-remove, so the name still shows in old history |
| `created_by` | UUID FK users | |
| `created_at`, `updated_at` | timestamptz | |

CHECK: phone or email present (unless the contact has been forgotten, see 8.3).

### 3.2 New table `approval_links`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `post_id` | UUID FK posts, cascade | indexed |
| `workspace_id` | UUID FK workspaces, cascade | indexed |
| `contact_id` | UUID FK brand_contacts null | set when sent to a saved contact |
| `token_hash` | char(64), unique | SHA-256 of the token. **The raw token is never stored** and is shown once |
| `content_hash_at_share` | char(64) | what the client is approving |
| `version_at_share` | int | shown to the client ("Version 3") |
| `recipient_name` | varchar(120) | snapshot of the name |
| `recipient_contact` | varchar(255) null | free-typed phone or email (owner/admin only) |
| `created_by` | UUID FK users | |
| `expires_at` | timestamptz | `created_at` + the chosen duration |
| `expiry_minutes` | int | the duration chosen, kept so "Resend" can reuse it |
| `resent_from_id` | UUID FK approval_links null | set when this link was made with **Resend** from an expired one |
| `revoked_at` | timestamptz null | |
| `revoke_reason` | varchar(40) null | `manual`, `contact_removed`, `brand_deactivated`, `resent` |
| `expiry_notified_at` | timestamptz null | set once the creator has been told the link expired, so they're told only once |
| `first_viewed_at`, `last_viewed_at` | timestamptz null | |
| `view_count` | int, default 0 | |
| `decision` | enum `approved` / `changes_requested`, null | |
| `decided_at` | timestamptz null | |
| `created_at` | timestamptz | |

CHECK: `decision` and `decided_at` are both set or both null.

### 3.3 Changes to `posts`
- `assigned_approver_id` UUID FK users, null: the **current** manager assignee.
- `assigned_contact_id` UUID FK brand_contacts, null: the **current** client assignee.
- CHECK: at most one of the two is set. Both are cleared when the post leaves `pending_approval`.
  Neither is part of the content hash.
- Index on `(assigned_approver_id) WHERE status = 'pending_approval'` for the "Waiting for my
  approval" list.

### 3.3b Changes to `workspaces`
- `approval_link_default_minutes` int null: the agency's default link expiry. NULL means use the
  platform default (`approval_link_default_minutes` setting). It's checked against the platform
  min/max when saved **and** again when a link is created, in case the super admin narrowed the
  range later; then it's clamped into range.

### 3.3c New table `notifications` (in-app bell, D10)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `workspace_id` | UUID FK workspaces, cascade | |
| `user_id` | UUID FK users, cascade | the recipient; indexed with `read_at` for the unread count |
| `type` | enum `notification_type` | see 3.5 |
| `post_id` | UUID FK posts, cascade, null | where the bell entry leads |
| `actor_name` | varchar(120) null | "Ramesh Patel (client)", "Amit Rao" |
| `message` | varchar(300) | ready-to-show text, e.g. "Ramesh Patel approved 'Diwali offer'" |
| `read_at` | timestamptz null | |
| `created_at` | timestamptz | |

Index: `(user_id, read_at)`. Rows older than **90 days** are deleted by a nightly job. No
personal data beyond names already visible to the workspace.

### 3.4 Changes to `approval_logs` (still append-only, never updated or deleted)
- `user_id` becomes **nullable** (a client has no user account).
- New: `approval_link_id` UUID FK approval_links null, and `actor_name` varchar(120) null (the client's name).
- New: `assigned_user_id` UUID null, `assigned_contact_id` UUID null, `assigned_name` varchar(120) null.
  These record who the post was assigned to when the row was written. The name is a snapshot,
  so it still reads correctly after a member leaves.
- New: `acted_by_assignee` bool null, set on approved/rejected rows.
- CHECK: exactly one of `user_id` / `approval_link_id` is set. Existing rows all have
  `user_id`, so they already pass.

### 3.5 Enums
- `audit_action`: add `SHARE_LINK`, `REVOKE_LINK`, `ASSIGN`, `CONTACT_CHANGE`.
- `admin_alert_type`: add `LINK_GUESSING`, `LINK_VOLUME_SPIKE`.
- New enum `approval_link_decision`: `approved`, `changes_requested`.
- `approval_action`: add **`reassigned`**. Every change of assignee, manual or automatic (D12), adds a
  history row with the new `assigned_*` values and a reason in `rejection_reason`, e.g. *"Priya Shah
  no longer has approval rights. Moved to any manager."* The history panel then shows the whole story.
- New enum `notification_type`: `assigned`, `client_approved`, `client_changes_requested`,
  `manager_approved`, `manager_rejected`, `link_expired`, `assignment_released`.

### 3.6 Admin database role (`omnipost_admin`, read-only)
- `approval_links`: SELECT on every column **except `token_hash` and `recipient_contact`**.
- `brand_contacts`: SELECT on `id, brand_id, workspace_id, is_active, created_at` only. **No
  name, phone or email**, so the super admin sees counts, never client personal data.
- `notifications`: **no grant.** They're workspace-internal messages.

---

## 4. Backend

### 4.1 Registered features (`core/features.py`)

| Key | Type | Default on every plan | Purpose |
|---|---|---|---|
| `client_approval_links` | boolean | on | Master switch. Off → the share button is hidden and **every existing link stops working on the next request** |
| `max_client_contacts_per_brand` | limit | on, unlimited | Plan tiering (e.g. Free 2) |
| `max_open_approval_links` | limit | on, unlimited | Caps unexpired, undecided links per workspace (anti-spam, tiering) |

The approver picker for managers isn't gated: it's part of the existing `approval_workflow` feature.

### 4.2 Registered settings (`core/settings_registry.py`)

| Key | Type | Default | Range |
|---|---|---|---|
| `approval_link_min_expiry_minutes` | integer | 15 | 5–1440 |
| `approval_link_max_expiry_minutes` | integer | 43200 (30 days) | 60–86400 (60 days) |
| `approval_link_default_minutes` | integer | 10080 (7 days) | must sit between min and max; used when a workspace has no default of its own |
| `public_approval_requests_per_minute_per_ip` | integer | 30 | 5–300 |
| `public_approval_decides_per_hour_per_link` | integer | 10 | 1–100 |
| `link_guessing_alert_threshold` | integer | 50 invalid tokens/hour from one IP | 10–1000 |
| `link_volume_alert_threshold` | integer | 200 links/day per workspace | 10–10000 |

All of these follow the admin change process (`docs/omnipost-docs/08_admin_panel_database.md` §5):
stored in the database, synced on startup, changed only via `/api/v1/admin/*`, audited with a
reason, effective on the next request.

### 4.3 Workspace endpoints (signed-in users)

| Method & path | Who | What |
|---|---|---|
| `GET /posts/{id}/approvers` | any member with post access | The picker: approver-role members (author left out when self-approval is off) and the **active brand's** active contacts. Also returns **`suggested`**: the previous assignee from the latest `submitted` or `reassigned` history row, if that person or contact can still approve (D11) |
| `POST /posts/{id}/submit` *(changed)* body `{assign_to_user_id?}` or `{assign_to_contact_id?}` | as today | Checks that the assignee belongs to this workspace with an approver role, or is an active contact of this brand. Stores the assignee on the post and on the `submitted` history row. With a contact it **also creates the link** and returns `{post, link: {url, expires_at}}`. With a manager it **notifies them** (`assigned`) |
| `PATCH /posts/{id}/assignee` | author or owner/admin | Reassign while pending. Adds a `reassigned` history row (earlier rows are never rewritten), audited as `ASSIGN`, and notifies the new assignee |
| `POST /posts/{id}/approve`, `/reject` *(changed)* | as today | Same guards; additionally copies the assignee onto the history row and sets `acted_by_assignee` |
| `POST /posts/{id}/approval-links` `{contact_id}` or `{recipient_name, recipient_contact?}`, `expires_in_minutes?` | contact: any member; free-typed: owner/admin | Pending posts only. Expiry: omitted → workspace default; must be within the platform min/max; **members can't go above the workspace default** (403 with a clear message). Returns the URL **once**. Checks `max_open_approval_links`. Audited as `SHARE_LINK` with the expiry |
| `GET /workspaces/{id}/approval-link-options` | any member | The presets this caller may choose (platform range ∩ role rule), plus the workspace default. Feeds the Share dialog dropdown |
| `POST /approval-links/{id}/resend` | creator or owner/admin; members only for saved contacts | For an **expired** (or revoked) link on a post that is **still pending with the same content**: creates a new link to the same recipient with the same duration (`resent_from_id` set) and returns the new URL once. Refused if the post changed or was decided |
| `PATCH /workspaces/{id}` *(changed)* `{approval_link_default_minutes}` | owner/admin | Sets the agency default; validated against the platform range. Audited |
| `GET /posts/{id}/approval-links` | any member with post access | Status list: not opened / opened N× / approved / changes requested / expired / revoked / out of date. Never returns tokens |
| `DELETE /approval-links/{id}` | creator or owner/admin | Revokes the link. Audited as `REVOKE_LINK` |
| `GET /workspaces/{id}/posts?assigned_to=me` *(changed)* | any member | "Waiting for my approval" |
| `GET /brands/{id}/contacts` | any member | Saved contacts |
| `POST / PATCH /brands/{id}/contacts[/{cid}]` | owner/admin | Checks `max_client_contacts_per_brand`. Audited as `CONTACT_CHANGE` |
| `DELETE /brands/{id}/contacts/{cid}[?forget=true]` | owner/admin | Soft-removes. `forget=true` also blanks phone and email (DPDP erasure); the name stays for history. **Also** revokes the contact's open links (`revoke_reason = contact_removed`) and moves their pending posts to "Any manager" (D12) |
| `GET /notifications?unread=true&page=` | signed-in user | Own notifications in the current workspace, newest first |
| `GET /notifications/unread-count` | signed-in user | The bell badge; a cheap indexed count |
| `POST /notifications/{id}/read`, `POST /notifications/read-all` | signed-in user | Mark as read; users can only touch their own rows |

All of them use the existing tenancy helpers (`get_post_access`, `get_brand_access`,
`get_workspace_member`) and the workspace rate limit.

### 4.4 Public endpoints (no login): `api/v1/public_approval.py`

The link looks like `https://<app>/a#<token>`. The token sits **after `#`**, which browsers never
send to a server, so it stays out of access logs, proxies and `Referer` headers. The page sends
it in a POST body.

| Method & path | Body | Returns |
|---|---|---|
| `POST /public/approval/view` | `{token}` | Agency name, brand name and logo, recipient name, version, `expires_at` **and `server_now`** (so the countdown is right even when the phone's clock is wrong), link state; for each platform the **rendered text** (same code as `/validate`) and media URLs in carousel order. Counts the view |
| `POST /public/approval/decide` | `{token, decision: approve \| request_changes, name, note?}` | The client's receipt: name, time, version, short fingerprint (12 characters) |

Rules:
- `resolve_link(token)`: hash the token, look up the link, then check: feature enabled, workspace
  not suspended, not revoked or expired, not decided, post still pending, live hash = submitted
  hash = link hash.
- **Unknown, expired and revoked links all return the same 404** ("This link is not valid"), so
  guessing reveals nothing. An out-of-date or already-decided link returns 409 with a friendly
  reason (and shows the existing decision).
- **Expiry is checked on the server at the moment of the decision**, never trusted from the page.
  Opening the page in time doesn't extend the deadline.
- **The brand must be active** (D13). A deactivated brand's links get the same 404 as an invalid link.
  Deactivating a brand also revokes its open links (`revoke_reason = brand_deactivated`).
- **First decision wins** (D9). Once the post has left `pending_approval`, every other open link for it
  returns 409 `already_reviewed`, and the page says *"This post has already been reviewed"*. It
  doesn't name the other reviewer, because clients of one brand shouldn't see each other's names.
  The same applies when a manager decides first.
- **Notifications on decision** (D10): the post's author, the link's creator, and the assigned manager
  (if any, and not the actor) each get `client_approved` / `client_changes_requested` /
  `manager_approved` / `manager_rejected`. Never the person who acted.
- On decide, the post row and the link row are **locked** (`SELECT … FOR UPDATE`). That stops a
  double tap from counting twice, and stops a client decision and a manager decision landing at
  the same time.
- **Approve** → post `approved` and a history row `approved` (`approval_link_id`, `actor_name`,
  hash, assignee, `acted_by_assignee`).
  **Request changes** (note required, 1–2000 characters) → post `draft` and a history row
  `rejected` with the note. Both clear the assignee on the post.
- An audit event records the client's name, IP and user agent, plus `"via": "client link"`.
- `public_rate_limit`: per IP and per link, using the settings in 4.2. Every invalid token is
  counted per IP for the guessing alert.
- Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.
- Responses never contain user emails, internal IDs beyond what the page needs, or the full hash.

### 4.5 Super admin endpoints (`api/v1/admin/*`, `require_super_admin`, read-only for content)

| Method & path | What |
|---|---|
| Existing plan, feature-override and settings endpoints | Cover every switch in 4.1 and 4.2. **No new write endpoint is needed** |
| `GET /admin/overview` *(extended)* | Adds: workspaces using client links (30 days), links sent this week, client-approved vs manager-approved share, median client approval time |
| `GET /admin/workspaces/{id}` *(extended)* | Adds per-workspace numbers: links created / opened / approved / changes requested / expired, median client approval time, "on behalf" approvals %, saved contacts count vs limit. **Counts only**, no names, contacts or links |
| `GET /admin/alerts` *(existing table, new types)* | `LINK_GUESSING`, `LINK_VOLUME_SPIKE` |

### 4.6 Background job (Celery Beat, every 15 minutes)
- `scan_approval_link_abuse`: raises `LINK_GUESSING` when an IP passes the invalid-token threshold,
  and `LINK_VOLUME_SPIKE` when a workspace passes the links-per-day threshold. It doesn't raise a
  second alert while one is open for the same subject.
- Note: the `admin_alerts` table exists but nothing creates alerts yet. This job is the first one.
- `notify_expired_links` (Beat, **every minute**, so a 15-minute link is reported promptly): finds links
  where `expires_at < now`, with no decision, no revocation and no `expiry_notified_at`, on posts still
  pending. It notifies the link's creator (*"Ramesh's link expired, Resend?"*) and sets
  `expiry_notified_at`, so each link is reported only once.
- `cleanup_notifications` (nightly): deletes notifications older than 90 days.

### 4.6b Assignment fall-back (D12): one shared service

`release_assignments(db, workspace_id, *, user_id=None, contact_id=None, reason)` in
`services/assignments.py`, called from **every** place that can take away approval rights:

| Trigger | Where it's called |
|---|---|
| Member removed from workspace | workspace members endpoint, admin `DELETE /admin/workspaces/{id}/members/{user_id}` |
| Role lowered below Admin | workspace members endpoint, admin `PATCH /admin/workspaces/{id}/members/{user_id}` |
| User account deactivated | the admin users endpoint that deactivates users |
| Ownership transferred, if the old owner becomes a plain member | admin ownership transfer |
| Contact removed or forgotten | `DELETE /brands/{id}/contacts/{cid}` |

For each pending post assigned to that person or contact, it clears the assignee, adds a `reassigned`
history row ("…moved to any manager", with the reason), writes an audit event, and notifies the
author (`assignment_released`). For a contact it also revokes their open links. It runs **in the same
transaction** as the trigger, so a member can never be removed while leaving dangling assignments behind.

The admin panel calls this service as a **side effect of its existing member and role actions**. The
super admin still doesn't act on posts directly (D8).

### 4.7 Schema changes
- `ApprovalLogResponse`: `user_id` becomes optional; it gains `actor_name`, `via_link`, `assigned_name`
  and `acted_by_assignee`.
- `PostResponse`: adds `assigned_approver_id`, `assigned_contact_id` and `assigned_name`.
- Regenerate `frontend/src/lib/api-schema.d.ts`.

---

## 5. Agency users: changes in the app

| Screen | Change |
|---|---|
| **Post page → Submit** | A dialog asks "Who should approve this?" with two groups: **Managers** (Priya Shah · Manager, Amit Rao · Owner, Any manager) and **Clients for {brand}** (Ramesh Patel · +91 98…, Neha · Marketing head). Owners and admins also see "+ Add client contact". Picking a client shows the link with **Share on WhatsApp** (`wa.me/<phone>?text=…`), **Email** (`mailto:`) and **Copy link**, and a note: *"This link is shown once."* Picking a manager offers *Share on WhatsApp* and *Copy link* with the in-app post link |
| **Share dialog: expiry** | "Link expires in: [24 hours ▾]". Presets 15 min · 1 hour · 24 hours · 3 days · 7 days, showing only those allowed (members see only up to the workspace default). The pre-filled WhatsApp and email text includes the deadline: *"…please approve within 24 hours (by 4:30 pm IST, 15 Nov)"*. The time zone label comes from the sender's browser (D14) |
| **Workspace settings** | "Default client link expiry" (owner/admin), a dropdown limited to the platform range |
| **Notification bell** (top bar, every page) | Unread badge, polled every 30 s from `/notifications/unread-count`. Opens a list; clicking an entry opens the post and marks it read; "Mark all as read". Entries: *Assigned to you*, *Ramesh approved "Diwali offer"*, *Neha requested changes*, *Amit approved your post*, *Ramesh's link expired, Resend*, *Priya can no longer approve "Diwali offer", now open to any manager* |
| **Resubmit after changes** | The Submit picker opens with the previous approver pre-selected: **"Send back to Ramesh Patel"**, one tap. If that person or contact can no longer approve, nothing is pre-selected and a short note says why |
| **History: reassignments** | `reassigned` rows show as *"Moved from Priya Shah to any manager: Priya no longer has approval rights"* or *"Reassigned to Amit Rao by Neha"* |
| **Post page (pending)** | "Assigned to Priya Shah · Change". A **Client links** list with status chips, time left (*"expires in 2 h"*), Revoke, and a **Resend** button on expired links (one tap; new link, same contact, same duration). "Share with client" for an extra link. Refreshes every 15 s while a link is open, so "Approved by client" appears without reloading |
| **Approval history** | Client rows: *"Ramesh Patel · client, via link"*. Rows where someone else stepped in: *"Assigned to Priya Shah · Approved by Amit Rao (on Priya's behalf)"*. The approval seal shows the real approver |
| **Home page** | A **"Waiting for my approval"** card: posts assigned to me first, then posts any manager can take |
| **Brand page** | A **Client contacts** section to add, edit, remove or forget contacts (owner/admin; read-only for members) |
| **Role labels** | "Admin" is shown as **Manager** in the app. The role itself is unchanged |
| **Plan limits** | Clear messages when a limit is hit ("Your plan allows 2 client contacts per brand") |

## 6. Clients: the public approval page `/a`

- A route **outside** the app shell and sign-in. It's lazy-loaded so it stays light on mobile data,
  has a `noindex` tag, and uses the owner palette in a light theme.
- **Layout** (works from 360px wide):
  1. The agency and brand header with the logo.
  2. "Hi Ramesh, {agency} asked you to review this post · Version 3". A **countdown**: *"Expires in
     12 minutes"* (shown in hours or days for long links), turning amber in the last 10% of the time.
     When it reaches zero the buttons switch off and the page shows the expired state.
     The exact deadline is shown **in the client's own time zone with its label** (D14), e.g.
     *"Approve by 3:00 pm GST, 15 Nov"* for a client in Dubai.
  3. Instagram / Facebook / LinkedIn tabs with the rendered text and a media carousel, framed like the real post.
  4. A bar fixed at the bottom with **Approve** and **Request changes**. The latter opens a note box. "Your name" is prefilled and can be edited.
  5. A **receipt**: *"Approved by Ramesh Patel · 14 Nov 2026, 4:12 pm · Version 3 · Fingerprint a1b2c3d4e5f6"*.
- **Expired:** *"This link expired at 4:30 pm. Ask {agency} for a new one."* If the client tapped
  Approve just after the deadline, the server refuses it and the page shows this same screen.
- **Other states:** link not valid, already decided by this client (shows their decision), **already reviewed by someone else**
  (*"This post has already been reviewed"*, with no names; D9), post changed since
  sharing ("ask {agency} for the new link"), temporarily unavailable (workspace suspended or
  feature switched off).
- Nothing to install, no account, no cookies.

## 7. Super admin panel: changes

| Page | Change | Type |
|---|---|---|
| **Plans** | Toggle `client_approval_links`; set `max_client_contacts_per_brand` and `max_open_approval_links` per plan | Control |
| **Workspace detail → Feature overrides** | Switch links off (or change a limit) for one workspace, with a required reason and an optional end date. This is the **emergency stop** for abuse | Control |
| **Settings** | The settings in 4.2, including the **link expiry range** (shortest / longest / default). Narrowing the range applies to new links at once; links already sent keep the expiry they were given | Control |
| **Overview** | A new **Client approvals** card: adoption, links this week, client vs manager approvals, median client approval time | View |
| **Workspace detail** | A new **Approvals** section: link funnel (created → opened → decided), median approval time, "on behalf" %, contacts compared with the plan limit | View |
| **Usage** | Contacts and open links compared with plan limits; over-limit is highlighted | View |
| **Audit** | New actions show up in the existing viewer: `SHARE_LINK`, `REVOKE_LINK`, `ASSIGN`, `CONTACT_CHANGE`, and client decisions (approve/reject with the "client link" marker) | View |
| **Alerts** | New alert types: **Link guessing** (by IP) and **Link volume spike** (by workspace), with the existing acknowledge/resolve | View |

**Deliberately not in the admin panel:** approving, rejecting, sharing, revoking or reassigning; editing
contacts; seeing link URLs or tokens; seeing client names, phone numbers or emails; reading
workspace notifications. When the super admin removes a member or changes their role with the
existing admin actions, the shared fall-back service (4.6b) moves that person's pending posts to
"Any manager" automatically. That's a side effect of the member action, not the admin acting on posts. If a workspace
misbehaves, the tools are the feature override or the existing **Suspend**.

---

## 8. Security & privacy

1. **Tokens:** 32+ random bytes (`secrets.token_urlsafe`), stored only as SHA-256, shown once, sent
   after `#` so they never reach logs.
2. **Tied to the exact content:** a link works only for the exact content and version it was sent for.
3. **Personal data (DPDP):** client phone and email are optional, never shown to the super admin,
   removed when the brand or post is deleted, and erasable with "forget". The decision IP is kept in
   the audit trail as evidence; it's mentioned in the limitations doc and the privacy notice.
4. **No member bypass:** members can send only to contacts that an owner or admin saved.
5. **Abuse:** per-IP and per-link rate limits, identical 404s, guessing and volume alerts, and the
   per-workspace emergency stop.
6. **Integrity:** the history rows are append-only; decisions take row locks; the publish worker
   still re-checks the approved hash.

---

## 9. Tests

**Backend (pytest)**
- *DB:* the migration runs on existing data; the CHECK constraints hold; the admin role can't read `token_hash`, `recipient_contact` or contact names, phones and emails.
- *Picker:* lists only approver-role members of this workspace (author left out when self-approval is off) and only this brand's active contacts.
- *Submit:* assignees from another workspace, plain members as assignees and other brands' contacts are rejected; a contact assignee creates a link.
- *Any manager:* assigned to Priya, approved by Amit → the history row has `assigned_name=Priya` and `acted_by_assignee=false`, and the audit event says the same; Priya then gets 400 (not pending).
- *Reassign:* audited while pending; refused after a decision.
- *Members:* can send to a saved contact; get 403 for a free-typed recipient.
- *Links:* the token is stored hashed and never returned by GET; view works only while valid; withdraw, manager approve, manager reject, expiry, revoke and the feature switch each make view/decide fail correctly; unknown, expired and revoked links give the same 404.
- *Decide:* approve → post approved with the right history and audit rows, **then schedule and run the worker guard → it publishes**; request changes needs a note → post goes back to draft; a double decision or two concurrent ones → exactly one wins.
- *Expiry:* the default comes from the workspace, or the platform when unset; a duration outside
  the platform range → 400; a member above the workspace default → 403; owner/admin up to the
  platform max → OK; a decision 1 second after `expires_at` → refused even though `view` succeeded
  earlier; the super admin narrowing the range clamps the workspace default on the next link;
  the min > max combination is refused when saving settings.
- *Resend:* works for an expired link on an unchanged pending post (new token, same duration,
  `resent_from_id` set; the old link stays dead); refused when the post changed or was decided.
- *First decision wins (D9):* two open client links: Ramesh approves → Neha's view and decide get
  `already_reviewed` with no name in the response; a manager approving first does the same to both
  links; concurrent decisions from two links → exactly one succeeds.
- *Notifications (D10):* submit to a manager → they get `assigned`; a client decision → author, link
  creator and assigned manager notified, the actor never; `notify_expired_links` reports each expired
  link once and skips decided, revoked or no-longer-pending ones; users can't read or mark other
  users' or other workspaces' notifications; the unread count is right; cleanup removes rows after 90 days.
- *Resubmit (D11):* after request changes, `suggested` = the previous assignee; it's empty when that
  person lost the role or the contact was removed.
- *Fall-back (D12):* for each trigger (member removed, role lowered, user deactivated, ownership
  transfer, contact removed or forgotten), via both the workspace endpoints and the admin endpoints:
  pending posts lose the assignee, a `reassigned` history row and an audit event are written, the author
  is notified, and a removed contact's open links are revoked. All of it in the same transaction:
  if the trigger fails, nothing changes.
- *Brand (D13):* deactivating a brand revokes its open links; a link to a deactivated brand → the same
  404 as an invalid one; its contacts are missing from the picker; deleting a post makes its tokens unknown.
- *Time zone (D14), frontend:* the WhatsApp text includes the sender's zone label; the client page
  shows the deadline in the device zone (check with the browser time zone set to Asia/Dubai).
- *Limits:* `max_client_contacts_per_brand` and `max_open_approval_links` enforced; plan and override changes take effect on the next request.
- *Rate limits & alerts:* 429 when exceeded; the guessing and volume alerts are raised once and not duplicated.
- *Admin:* the new overview and workspace stats return counts only; no endpoint leaks contacts or tokens.

**Frontend:** check by hand in the browser pane at 375px and on desktop. Journeys: submit → pick
manager → manager approves; submit → pick client → open the link in a private tab → approve → the
agency screen updates → schedule; request changes → edit → resubmit → the old link is out of date;
admin switches the feature off → the link shows "unavailable".

---

## 10. Build order & effort

| # | Work | Days |
|---|---|---|
| 1 | Migration, models, enums, registry features and settings, admin DB grants | 0.75 |
| 2 | Contacts CRUD, approver picker, submit/assign/reassign, history changes in approve/reject | 0.75 |
| 3 | Link endpoints, public view/decide, rate limiting | 1 |
| 4 | Admin stats endpoints, alerts job | 0.5 |
| 5 | Backend tests | 1 |
| 6 | App: Submit picker, Share dialog, Client links list, assignee, history rows | 1.25 |
| 7 | App: "Waiting for my approval" card, brand Client contacts, Manager label, limit messages | 0.5 |
| 8 | Client page `/a` with every state, mobile polish | 1 |
| 9 | Admin panel: Approvals cards on Overview and Workspace detail, new alert and audit labels | 0.5 |
| 10 | End-to-end check, docs (`known_limitations`, backend guide, admin guide) | 0.25 |
| 11 | Link expiry levels: settings in minutes, workspace default, member rule, Resend, countdown, presets (backend + app + client page + tests) | 0.5 |
| 12 | In-app notifications: table, endpoints, the two Beat jobs, bell in the top bar, tests (D10) | 1 |
| 13 | First-decision-wins states, resubmit suggestion, fall-back service hooked into every trigger, brand deactivation, time zone labels, plus tests (D9, D11–D14) | 0.5 |
| | **Total** | **≈ 9.5 days** |

Steps 1–5 (backend) come first so the frontend builds against real endpoints. Step 9 can run in
parallel with steps 6–8.

---

## 11. Known limitations (to tell customers)

- Carousel **order** isn't part of the content hash (existing behaviour). Reordering after
  approval doesn't cancel the approval; adding or removing media does.
- A link proves "someone with this link, giving this name, from this IP", not identity. A
  one-time code to the client's phone or email can be a paid add-on later.
- Whoever creates a link could open it themselves. The audit trail shows the creator, IP and device
  for each decision, so it's visible but not prevented.
- Notifications are **in-app only** (the bell). We don't send email, WhatsApp or push notifications
  yet: someone who isn't signed in sees them next time they open the app. The share buttons let the
  agency nudge people from its own WhatsApp or email.
- A client approval is final (D1). There's no "manager first, then client" chain in v1.
- With several reviewers, the **first decision wins** (D9). "Everyone must approve" isn't in v1.

---

## 12. Implementation notes (2026-11-14)

What was built, and the few places it differs from the plan above.

**Where the code is**
- Database: `backend/alembic/versions/0007_client_approval_links.py`, models in `backend/app/models/approval.py`.
- Services: `app/services/approvals.py` (picker, assignment, fall-back, notifications), `app/services/approval_links.py`
  (tokens, lifetimes, link state), `app/services/approval_stats.py` (admin counts).
- API: `app/api/v1/approvals.py` (agency side), `app/api/v1/public_approval.py` (client side), changes in `posts.py`,
  `brands.py`, `workspaces.py`, `admin/overview.py`, `admin/workspaces.py`, `admin/plans.py`, `admin/content.py`.
- Jobs: `app/workers/tasks/approvals.py` (4 Beat jobs).
- Tests: `backend/tests/integration/test_client_approvals.py` (16 tests). Full suite: 185 passed.
- Web: `src/lib/approvals.ts`, `src/pages/posts/ReviewerDialogs.tsx`, `src/pages/ClientApprovalPage.tsx` (route `/a`),
  `src/app/NotificationBell.tsx`, `src/pages/BrandContactsDialog.tsx`, plus Home, Settings, Brands, Post Studio, history
  panel and the admin Overview / Workspace pages.

**Differences from the plan**
1. **Fall-back after admin-panel changes runs as a 1-minute sweep, not in the same transaction.** The admin API
   runs as the `omnipost_admin` database role, which cannot write customer content (by design, migration 0006).
   So when the super admin removes a member, lowers a role or deactivates a login, `release_stale_assignments`
   (Beat, every minute) moves that person's pending posts to "any manager", writes the `reassigned` history row
   and notifies the author. Customer-side triggers (removing a saved contact, deactivating a brand) still happen
   at once. Any manager can approve in the meantime, so nothing is blocked during that minute.
2. **Notification endpoints are under the workspace:** `/workspaces/{id}/notifications`, `.../unread-count`,
   `.../{nid}/read`, `.../read-all` (tenancy and rate limiting work like every other workspace route).
3. **Two extra columns:** `posts.assigned_name` (display snapshot, so post lists need no extra lookup) and
   `brand_contacts.forgotten_at` (marks a DPDP erasure; the CHECK allows a forgotten contact with no phone or email).
4. **Client page states:** besides the plan's states, a link whose post was *withdrawn* (not decided) shows
   "The agency is updating this post" instead of "already reviewed".
5. **Super admin post view** shows "Client (via link)" instead of the client's name in the approval history (D8).
6. **Switching the feature off** answers "temporarily unavailable" on the client page (plan §6), not "not valid".
7. **Workspace default lifetime:** sending `0` resets it to the platform default.
