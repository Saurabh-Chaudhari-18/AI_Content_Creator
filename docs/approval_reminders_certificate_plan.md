# Approval Deadlines, Reminders & Certificate v2 — Plan

**Status:** built 2026-11-24 on branch `feat/approval-deadlines-certificates` (not committed yet) · decisions R1–R6 taken as recommended · see §9
**Scope note:** outside the owner's agreed Phase 1 scope (like the client approval links,
`docs/client_approval_link_plan.md`). Confirm with the owner before building.
**Source:** `reports/Social media SaaS competitor features.md` — "Approvals: the bottleneck is the
client" and "Approval Evidence".

---

## 0. Summary

| | |
|---|---|
| **What** | (1) Every post sent for approval gets a **"Needed by"** deadline. Before and after the deadline, the right people are **reminded**, and an overdue post is **escalated** to the managers. (2) The existing approval certificate becomes a **record built by the server** from the approval history. It includes the whole review trail, the wording for each platform, what was actually published, and a **verify link** anyone can check. |
| **Why** | Agencies lose days waiting for clients. Our approvals are tied to the exact content, but the certificate is still built in the browser from the live post. It doesn't show *how* the approval happened or *what went live*, and nobody outside the app can check it. |
| **Running cost** | **Zero in v1** (see R1). Reminders go out through the in-app bell plus a one-tap WhatsApp/email nudge sent from the agency's own phone. Sending email automatically is a separate decision. |
| **Effort** | **≈ 10 days** (section 7). |

### What exists today (checked in code, 2026-11-24)

- `Seal.tsx → ApprovalCertificate`: a print-to-PDF dialog. The browser builds it from **live post
  data** (`ApprovalPanel.tsx:172`): brand, title, version, main caption, hashtags, first image,
  submitter, approver, approval time and fingerprint. Its number is `OP-` + the first 8 characters of the hash.
- The certificate does **not** show: the platform-specific wording (`platform_targets`), all media
  in order, the CTA, whether the approval came from a manager or a client link (and the link's
  open and decision times), "approved on someone's behalf" (`acted_by_assignee`), earlier rounds
  (changes requested, then resubmitted), or the publish outcome.
- Posts are hard-deleted, so the certificate disappears with the post (BIZ-05 in the audit).
- No deadlines or reminders exist. The only approval-related timer is link expiry (`notify_expired_links`).
- **We don't send any email or WhatsApp ourselves.** Links and nudges go out through `wa.me` /
  `mailto:` from the agency's own accounts (`frontend/src/lib/approvals.ts`).
- Only the hash of a link's token is stored, so **a reminder can't include the original link
  again**. It can refer to it ("the link I sent on 15 Nov"), or a fresh link can be created.

---

## 1. Decisions to confirm

| # | Decision | Recommendation |
|---|---|---|
| **R1** | **How do client reminders reach the client?** (a) Zero cost: the person who shared the link gets a bell reminder with a ready-made WhatsApp/email nudge and sends it in one tap. (b) Add an email provider (Resend/SES, a free tier covers early use) to email clients and managers automatically. (c) WhatsApp Business API: about ₹0.86 per message plus Meta template approval. | **(a) for v1.** It keeps the zero-cost promise and matches how links are sent today. Plan (b) together with password-reset email (audit SEC-09), since both need the same provider. (c) is Wave 2. |
| **R2** | **What happens when a post is overdue?** | Remind, then escalate to all owners and managers. Optional per-brand switch: "move to Any manager after N hours". **Never auto-approve.** An approval must be a person's act, or the certificate means nothing. Say this to customers as a deliberate choice. |
| **R3** | **Public verify page** (`/verify/<certificate id>`) | **Yes**, with a random certificate ID (not the hash prefix, which can be guessed), rate-limited. It shows only: valid / not valid, brand, version, approved on, approved by, fingerprint, published yes/no. No caption, media or contact details. A per-workspace switch to turn it off. |
| **R4** | **Does the certificate survive post deletion?** | **Yes.** Save a snapshot when the post is approved, in a new table that isn't deleted with the post. Text and fingerprint are kept; images show "media removed". Workspace deletion still erases everything (DPDP). |
| **R5** | **Default deadline** | 48 hours from submit, set per workspace and changeable per brand. The person submitting can change it. The super admin sets the allowed range (default 1 hour to 14 days), following the admin change process. |
| **R6** | **Client receipt** | After a client approves through the link, the `/a` page offers "Save your receipt": the same certificate. It's good for the client's trust and costs nothing. |

---

## 2. Part A — Deadlines, reminders, escalation

### 2.1 Flow

```
Submit ─► "Needed by: Thu 28 Nov, 6:00 pm IST"  (default from brand → workspace → 48 h)
           │
           ├─ 24 h before due (only if the window is longer than 24 h) ─► reminder #1
           ├─ at due time                                               ─► "overdue" reminder
           └─ due + escalate_after (default 24 h)                       ─► escalation to owners/managers
                                                                           (+ optional: move to Any manager)
Approve / Request changes / Withdraw ─► all pending reminders for this round stop
Resubmit ─► new round, new deadline, reminder stages reset
```

### 2.2 Who gets what

| Assignee | Reminder goes to | Content |
|---|---|---|
| A manager | That manager (bell) | "Approve 'Diwali offer' by 6:00 pm IST today" |
| Any manager | All owners and managers (bell) | Same |
| A client contact | **The person who shared the link** (bell), with a **Send reminder** button that opens WhatsApp/email with ready-made text | Uses the link's view data: *"Ramesh opened it 2 h ago but hasn't decided"* or *"Ramesh hasn't opened it yet"* |
| Escalation | All owners and managers, plus the author | "Overdue by 1 day — waiting for Ramesh (client)" |

Reminder text for the client (sent through the agency's WhatsApp/email, R1a):
> Hi Ramesh, a quick reminder: the post "Diwali offer" for Acme is waiting for your approval,
> needed by 6:00 pm IST, 28 Nov. Please use the link I sent on 26 Nov.

If the client's link has **expired or will expire before the deadline**, the button becomes
**Send a fresh link** (the existing resend flow) instead.

Time zone (plan D14 rule): the deadline is always shown with its time zone. It's saved as UTC
plus the submitter's IANA zone, which is used in reminder text.

### 2.3 Where it shows in the app

- **Submit picker:** a "Needed by" field with presets (Today 6 pm · Tomorrow · 48 h · Pick date & time).
- **Post cards / Approval Studio / Posts list:** a deadline chip, "Due in 5 h". It turns amber
  under 24 h and red when overdue. A new **Overdue** filter is added (kept in the URL, like the other Posts filters).
- **Home:** a "Waiting on clients" count with the overdue ones listed first.
- **Approval timeline (`ApprovalPanel`):** "Reminder sent to Ramesh via WhatsApp · 27 Nov 10:02".
  This is recorded when the user taps Send. We can't confirm it was delivered, and the label says only "sent".
- **Brand settings:** default deadline, "escalate after", and the "move to Any manager when overdue" switch.

### 2.4 Database (migration `0009_approval_deadlines_certificates`)

`posts`
- `approval_due_at timestamptz NULL`, `approval_due_tz varchar(50) NULL`. Set on submit and
  cleared when the post leaves pending.

`approval_logs` (still append-only)
- `due_at timestamptz NULL` on `submitted` rows: a snapshot of the deadline for that round.

`brands`
- `approval_due_hours int NULL` (NULL = workspace default)
- `approval_escalate_after_hours int NULL`
- `approval_release_when_overdue bool NOT NULL DEFAULT false`

`workspaces`
- `approval_due_default_hours int NULL` (NULL = platform default 48)

New table `approval_reminders` (append-only, one row per reminder event)
- `id, post_id (FK cascade), workspace_id, submission_log_id (FK approval_logs.id)`
- `stage` enum: `due_soon | overdue | escalated | manual_nudge`
- `recipient_user_id NULL, recipient_contact_id NULL, channel` enum: `in_app | whatsapp | email`
- `created_by NULL` (NULL = system), `created_at`
- **Unique `(submission_log_id, stage)` where `stage <> 'manual_nudge'`.** This stops the job from sending the
  same stage twice, even if two workers run at once.

### 2.5 Backend

- `workers/tasks/approvals.py → send_approval_reminders`, run by Beat **every 5 minutes**.
  It selects pending posts whose next stage is due (`FOR UPDATE SKIP LOCKED`, `LIMIT 500`, the same
  pattern as `notify_expired_links`), inserts the stage row (`ON CONFLICT DO NOTHING` = already
  sent), then calls `reviewers.notify(...)`. Escalation with the release switch on uses the existing
  `reviewers.release_one(...)`, so history and author notification work as they do today.
- New `NotificationType`s: `APPROVAL_DUE_SOON`, `APPROVAL_OVERDUE`, `APPROVAL_ESCALATED`.
- `POST /posts/{id}/submit` accepts an optional `due_at`. It's checked against the platform range
  and must be in the future. If it's missing, the brand default applies, then the workspace default.
- `POST /posts/{id}/reminders` `{channel}` records a manual nudge (rate limit: 1 per post per 30 min).
  Members can nudge only posts they authored or links they shared.
- `GET /workspaces/{id}/posts?overdue=true` filter; `approval_due_at` added to the post schemas.
- Index: `ix_posts_pending_due (approval_due_at) WHERE status = 'pending_approval'`.
- Feature switch `approval_reminders` in `core/features.py` (on for all plans at launch).
  Settings `approval_due_min_hours`, `approval_due_max_hours`, `approval_due_default_hours`,
  `approval_escalate_default_hours` in `core/settings_registry.py`. Both follow the **admin change
  process** (`docs/omnipost-docs/08_admin_panel_database.md` §5): stored in the database, registered
  in code, changed only through the admin API, audited, effective on the next request.
- Approval stats (`services/approval_stats.py`): add **median time to decision** and **% decided by
  the deadline** per brand. These feed the later monthly brand report.

---

## 3. Part B — Approval certificate v2

### 3.1 What the certificate shows

1. Header: brand, post title, **certificate ID**, verify link and QR code.
2. **Approved content, exactly as hashed:** caption, hashtags, CTA, **every media item in order**
   (thumbnails), and a tab or section for **each platform's wording** (rendered text, as the
   `validate` endpoint produces it).
3. **Decision:** approved by (name, role, or "Client via approval link"), on behalf of (when
   `acted_by_assignee = false`), when, how long after submission, and whether it was before the deadline.
4. **Client link facts** (client approvals only): link sent by, sent on, first opened, decided on.
   IP and device stay in the audit log and **aren't printed**. The certificate may be shared outside the agency.
5. **Review trail:** each round (submitted v1 → changes requested "make the logo bigger" →
   resubmitted v2 → approved), plus reminders sent.
6. **Published:** for each platform, the publish time, a link to the live post, and "**Published content matched the approved
   fingerprint**". The worker checks the hash before publishing, so we can state this. Failed or
   needs-review jobs are shown as they are.
7. Footer: the full SHA-256, an explanation of the fingerprint (existing text), and the issue date.

### 3.2 How it's built

- New table `approval_certificates`, written **once, at the moment of approval** (manager or
  client), in the same transaction as the `approved` ledger row:
  `id, public_id (random, 12 characters, base32), workspace_id, brand_id, post_id (FK SET NULL —
  survives post deletion, R4), approval_log_id, content_hash, version, snapshot JSONB (title,
  caption, hashtags, cta, platform_targets rendered, media [{key, type, order, alt}], brand name,
  submitter, approver, link facts), created_at`. Never updated; the database role can only insert into it.
- If an approval is invalidated and the post approved again, a new certificate is issued. The old one
  shows "**Superseded** — content changed after this approval" on its verify page.
- Publish results aren't part of the snapshot. They're read live from `publish_jobs` when someone views it
  (they happen later).
- `GET /posts/{id}/certificate` → the latest certificate plus the review trail and publish results
  (tenancy through `get_post_access`). `GET /certificates/{public_id}` for a certificate whose post was deleted.
- Public `GET /public/certificates/{public_id}/verify` (no login) → minimal fields only (R3),
  rate-limited and counted like invalid link tokens (`INVALID_TOKEN_KEY` pattern), so guessing shows
  up in the existing `LINK_GUESSING` admin alert.
- Backfill: the migration creates certificates for currently approved, scheduled and published posts from
  their latest `approved` log, marked `backfilled: true` in the snapshot.

### 3.3 Frontend

- `ApprovalCertificate` takes the server's certificate data instead of building it from the post.
  Its look stays the same (the Round 3 cream sheet and wax seal) and grows to two pages when needed. Print-to-PDF
  stays. A **real server-made PDF** (WeasyPrint) is a later step if agencies ask for email attachments
  from their phones.
- **Copy verify link** button.
- New public page `/verify/:id` (no login, same style as `ClientApprovalPage`).
- **Client receipt** (R6): after Approve, `ClientApprovalPage` shows "Save your receipt", which opens
  the same certificate without the publish section, as the post hasn't gone out yet.
- Settings → Workspace: "Allow public certificate verification" switch (owner only).

---

## 4. Security & privacy

- The certificate ID is random and separate from the hash. Verify returns no content, contact
  details, IP or device.
- Reminders never go to an address the agency didn't save or type. The system sends nothing
  outside the app in v1.
- The `approval_reminders` and `approval_certificates` tables follow the same tenancy as posts. The admin
  database role gets read-only access to counts only (super admin = observer).
- Forgetting a client contact (DPDP erase) replaces their name in certificate snapshots with "Client (erased)"
  when the snapshot is read, without rewriting the stored row. This needs a decision if legal review says the snapshot itself must change.

## 5. Tests

- Reminder job: each stage is sent once; there are no duplicates when two workers run together; nothing is sent
  after a decision, withdraw or invalidation; resubmit resets stages; a window shorter than 24 h skips "due soon";
  release-when-overdue writes a `reassigned` row and notifies the author.
- Deadline checks: outside the platform range → 400; a member can't set a deadline beyond the brand default range.
- Certificate is written in the same transaction as approval (manager and client paths); it survives post
  deletion; re-approval supersedes; verify returns minimal fields; unknown IDs are counted for the
  guessing alert; another workspace's certificate isn't readable through the signed-in endpoint.
- Snapshot equals the content that produced `content_hash` (recompute the hash from the snapshot in the test).
- Frontend: deadline chip states; Overdue filter in the URL; certificate renders from server data.

## 6. Known limitations (tell customers)

- v1 doesn't send email or WhatsApp by itself. Reminders reach the client when someone on
  the team taps **Send reminder**. "Sent" means the WhatsApp or email screen was opened, not that the message was delivered.
- No auto-approve, deliberately.
- Print-to-PDF only; no emailed PDF yet.
- The verify page proves the certificate is genuine and unchanged. It doesn't prove the approver's identity
  (same limit as the approval links, plan §11).

## 7. Build order & effort

| # | Step | Days |
|---|---|---|
| 1 | Migration 0009, models, enums, settings/feature registration | 1 |
| 2 | Submit `due_at`, defaults, Overdue filter, schemas | 1 |
| 3 | Reminder job, notifications, manual nudge endpoint | 1.5 |
| 4 | Certificate table, write-on-approval, backfill, endpoints, verify endpoint | 1.5 |
| 5 | Frontend: "Needed by" field, deadline chips, Overdue filter, Home count, brand settings, Send reminder | 2 |
| 6 | Frontend: certificate v2, Copy verify link, `/verify` page, client receipt | 1.5 |
| 7 | Tests (backend + key UI states), docs, admin panel counts | 1.5 |
| | **Total** | **≈ 10 days** |

Steps 1–4 (backend) and 5–6 (frontend) can overlap once the schemas from step 2 are fixed.

## 8. Later (not in this plan)

- Email provider (R1b) → automatic emails to managers and clients, plus password reset.
- WhatsApp Business API reminders (Wave 2).
- Monthly per-brand approval report PDF: certificates issued, median turnaround, % on time,
  revision log.
- Server-made PDF certificate; "everyone must approve" (plan D9 follow-up).

## 9. Implementation notes (2026-11-24)

Built as planned, with these differences:

- **Migration** is `0009_approval_deadlines_certs` (Alembic revision ids are limited to 32 characters).
- **Deadline after the round:** `posts.approval_due_at` is not cleared when a post leaves pending. It is
  only shown and acted on while the post is pending; each round's own deadline stays on its
  `submitted` history row (`approval_logs.due_at`).
- **Who picks a deadline:** anyone who can submit may pick any deadline inside the platform range.
  The plan's "members only up to the brand default" was dropped: a later deadline doesn't weaken anything.
- **Extra endpoint:** `GET /workspaces/{id}/approval-deadline-options?brand_id=` gives the picker and
  the settings screens the range, the brand's default and whether the plan includes deadlines.
- **Manual nudge:** instead of refusing a second nudge within 30 minutes, two taps by the same person
  within 10 minutes count as one reminder (WhatsApp and then email is one reminder, not an error).
- **Only the latest due stage is sent.** If the worker was down, an earlier stage it missed is skipped
  (nobody needs "due in 24 h" for a post that is already overdue).
- **Backfill** happens the first time a certificate is asked for, not in the migration, so the
  snapshot is built by the same code as a new certificate (marked "Issued from the approval record").
- **The snapshot also holds the review history and the reminder counts**, because history rows are
  deleted with the post and the certificate must still read correctly afterwards.
- **Public check:** `GET /api/v1/public/certificates/{number}` and the page `/verify/<number>`
  (also `/verify` with a box to type the number). Numbers are 12 characters, shown as `XXXX-XXXX-XXXX`,
  without 0/O/1/I/L; any case, dashes or spaces are accepted. Misses count towards the existing
  link-guessing alert.
- **Not built yet:** admin-panel counts (the read-only database grants are in the migration, the
  admin screens are not), a server-made PDF, and the monthly brand approval report.

Tests: `backend/tests/integration/test_approval_deadlines.py` (13) and
`backend/tests/test_approval_deadlines_unit.py` (6).

## 10. Email: automatic reminders and forgot-password (built 2026-11-24)

Decision R1 moved from (a) to (a) + (b): the in-app bell and the one-tap nudge stay, and the system
can now also send email. Nothing is sent until a mail server is configured, so the running cost
starts only when the owner approves a provider.

**How it works**
- Any code that wants an email adds a row to `email_outbox` in its own transaction (migration
  `0010_email_outbox`). The Beat job `send_queued_emails` (every minute) delivers it, retries up to
  three times, then gives up. A slow or broken mail server never slows a request.
- The body is stored encrypted and wiped once the email is sent or given up on (a password-reset
  email carries a usable link).
- Provider-neutral: `EMAIL_BACKEND=console | smtp | off` plus the `SMTP_*` settings in `.env`
  (secrets stay out of the admin panel). `console` writes emails to the log for development and is
  refused in production. `PRODUCT_NAME` is the name people see in emails.
- Limits: plan feature `email_notifications` (on in every plan; the super admin can switch it per
  plan or workspace) and platform setting `max_emails_per_workspace_per_day` (default 200; emails
  over it are skipped, the bell still works).

**Who gets what**

| Email | To | When |
|---|---|---|
| "X asked you to approve…" | The assigned manager | On submit and on reassign |
| Deadline near / passed / escalated | The same people as the bell | The reminder job's stages |
| Client reminder | The assigned client contact | Deadline near and passed, only if all of: the workspace switched on "Remind clients by email automatically" (off by default), the contact has an email, has not opted out, and still holds a working link |
| Reset your password | The account's address | `POST /auth/forgot-password` |

- Each person can switch their own approval emails off (Settings → Email, `users.email_notifications`).
- A client reminder never repeats the approval link (we only keep its fingerprint). It points to the
  message that carried it, and replies go to whoever shared the link.
- Every client reminder ends with a "stop these reminders" link (`/email/stop#<token>`, signed, never
  stored). It sets `brand_contacts.email_opt_out_at`; only the client can set it, and the agency sees
  "Asked us to stop reminder emails" on the contact.
- When a client was emailed, the reminder row's channel is `email`, so the post's history says so.

**Forgot password**
- "Forgot password?" on the sign-in page → `/forgot-password`. The answer is the same whether or not
  the address has an account. At most three emails per address per hour, plus the per-IP limit.
- It reuses the existing one-time setup link and the `/set-password` page. With email off the endpoint
  answers 503 with a plain explanation.

**Not built yet:** email verification on sign-up, HTML templates with the agency's logo, bounce
handling, WhatsApp Business API, and admin-panel counts of emails sent (the read-only grants exist).

**Before switching on in production:** choose a provider and a sending domain, set SPF and DKIM for
it, set `EMAIL_BACKEND=smtp`, and confirm the privacy policy mentions emails sent to clients on an
agency's behalf (DPDP).

Tests: `backend/tests/integration/test_email.py` (7) and `backend/tests/test_email_unit.py` (4).
