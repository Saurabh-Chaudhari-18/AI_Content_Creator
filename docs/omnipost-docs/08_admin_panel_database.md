# 8. Admin Panel — Database and API

Status (12 November 2026): **the backend is built** — the database (migrations `0005_admin_platform` and `0006_admin_db_role`), the feature and limit checks in the customer API, suspended workspaces being read-only, and the admin API under `/api/v1/admin` (§6). **Not built yet:** the admin screens in the web app, the "set your password" page, the web app hiding or locking what a plan does not include, and the nightly usage job that fills `usage_daily` and `admin_alerts`. This extends the 13 tables in [02_database.md](02_database.md) to 21.

## What the super admin is

The super admin is the **product owner (Updon)**, not a customer. The role exists for **billing and catching misuse** — for example a free-plan workspace getting unlimited use because of a bug.

| Kind of data | Super admin can |
|---|---|
| **Accounts** — users, workspaces, members, roles, login setup links | Create and change |
| **Platform settings** — plans, features, per-customer overrides, templates, platform settings, alerts | Create and change |
| **Customer content** — brands, posts, media, approvals, social accounts, publish jobs | **Read only** |

The super admin is **never** a member of a customer workspace and never uses the customer API routes. All admin work goes through `/api/v1/admin/*`.

## How the new tables relate

```
users ── platform_role (new column)
  │
  └── user_setup_tokens          one-time "set your password" links

workspaces ── plan_id ──► plans ──► plan_features ──► features ◄── workspace_feature_overrides ◄── workspaces
     │
     ├── usage_daily              nightly usage counted from real data
     └── admin_alerts             over-limit / mismatch / spike alerts

platform_settings                 any other admin-controlled setting (key → value)
audit_events                      existing table, gets new actions + who-was-platform-staff
```

---

## 1. Changes to existing tables

### `users`

| Column | Type | Notes |
|---|---|---|
| `platform_role` | enum `platform_role` (`super_admin`), **NULL** for customers | Platform staff only. More values (`support`, `billing`) can be added later. Never settable through the customer API. |
| `last_login_at` | timestamptz, NULL | Set on every successful login. Powers "last active" in the admin panel. |

A user created from the admin panel gets an **unusable password hash** until they open their setup link, so nobody — including the super admin — ever knows their password.

### `workspaces`

| Column | Type | Notes |
|---|---|---|
| `plan_id` | UUID → `plans.id`, NOT NULL | The customer's plan. |
| `status` | enum `workspace_status` (`active`, `suspended`), default `active` | Suspended workspaces can sign in and read, but every write and every publish is blocked. Checked in `get_workspace_member` **and** in the publish worker. |
| `suspended_at` | timestamptz, NULL | |
| `suspended_reason` | text, NULL | Required when suspending. |

Workspaces are **never deleted from the admin panel** — deletion cascades to posts and media, which is customer content. Suspend instead.

### `audit_events`

| Column | Type | Notes |
|---|---|---|
| `actor_platform_role` | varchar(30), NULL | Snapshot of the actor's platform role. Lets a customer's audit log show "done by OmniPost staff". |
| `reason` | text, NULL | Required for every admin change (see the process rule below). |

New `audit_action` values: `VIEW` (admin opened customer content), `SUSPEND`, `REACTIVATE`, `PLAN_CHANGE`, `FEATURE_CHANGE`, `SETTING_CHANGE`, `OWNERSHIP_TRANSFER`, `SETUP_LINK`, `FORCE_LOGOUT`, `ALERT_UPDATE`.

---

## 2. New tables

### `plans` — what customers can buy

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `key` | varchar(50), unique | Stable code name: `free`, `pro`, `agency`. |
| `name` | varchar(100) | Shown in the UI. |
| `description` | text, NULL | |
| `is_default` | boolean | The plan new sign-ups get. **Partial unique index**: only one row can be `true`. |
| `is_active` | boolean | Retired plans stay for existing customers but can't be assigned to new ones. |
| `sort_order` | int | Display order. |
| `created_at`, `updated_at` | timestamptz | |

### `features` — every switchable feature

| Column | Type | Notes |
|---|---|---|
| `key` | varchar(100) **PK** | e.g. `linkedin_publishing`, `max_brands`. |
| `name` | varchar(150) | Shown in the admin panel. |
| `description` | text | |
| `value_type` | enum `feature_value_type` (`boolean`, `limit`) | `boolean` = on/off. `limit` = on/off plus a number. |
| `category` | varchar(50) | Grouping in the panel: Publishing, Team, Storage, AI… |
| `global_enabled` | boolean, default `true` | **Kill switch**: `false` turns the feature off for everyone, whatever their plan. |
| `is_active` | boolean | Set to `false` automatically when a feature is removed from code. |
| `created_at`, `updated_at` | timestamptz | |

**Rows are created by code, not by hand.** The feature list lives in `app/core/features.py`; on startup the app inserts new keys, refreshes names and descriptions, and marks removed ones inactive (it never touches `global_enabled`). A newly added feature is in no plan yet, so it is off for everyone until it is added to plans. The admin panel can change the switches, but can't invent a feature the code never checks.

### `plan_features` — what each plan includes

| Column | Type | Notes |
|---|---|---|
| `plan_id` | UUID → `plans.id` ON DELETE CASCADE | |
| `feature_key` | varchar(100) → `features.key` | |
| `enabled` | boolean | |
| `limit_value` | bigint, NULL | Only for `limit` features. **NULL = unlimited.** |
| `updated_at` | timestamptz | |

Primary key `(plan_id, feature_key)`. A feature with no row for a plan counts as **off** — safe by default.

### `workspace_feature_overrides` — per-customer exceptions

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `workspace_id` | UUID → `workspaces.id` ON DELETE CASCADE | |
| `feature_key` | varchar(100) → `features.key` | |
| `enabled` | boolean | |
| `limit_value` | bigint, NULL | NULL = unlimited (for `limit` features). |
| `expires_at` | timestamptz, NULL | For trials. After this time the override is ignored and the plan value applies again. |
| `reason` | text, NOT NULL | Why this customer is different. |
| `set_by_user_id` | UUID → `users.id` | |
| `created_at`, `updated_at` | timestamptz | |

Unique `(workspace_id, feature_key)` — one override per feature per customer. "Default" in the panel means **no row**.

### How a feature is decided

```
1. features.global_enabled = false            → OFF (for everyone)
2. override exists and not expired             → use the override
3. otherwise                                   → use plan_features for the workspace's plan
4. no plan_features row                        → OFF
```

One function, `resolve_features(workspace_id)` in `app/services/features.py`, does this. Routes call `require_feature(...)` for an on/off feature and `enforce_limit(...)` for a number. The web app reads the result from `GET /workspaces/{id}/features`.

A refused request is a **403** with a plain-text reason ("LinkedIn publishing isn't included in your plan.") and two response headers the web app can read: `X-Plan-Restriction` (`feature_disabled` or `limit_reached`) and `X-Plan-Feature` (the feature key).

### What each feature controls

| Feature | Checked when |
|---|---|
| `facebook_publishing`, `instagram_publishing`, `linkedin_publishing` | Connecting an account of that platform; publish now, schedule and retry to it. The pre-publish check (`/validate`) reports it too. |
| `scheduling` | Scheduling a post for later. Publish now is not scheduling. |
| `max_social_accounts` | Connecting an account. Disconnecting frees a place. A Facebook login that brings more pages than fit connects the ones that fit and reports the rest as skipped. |
| `caption_templates` | Reading the template library. |
| `approval_workflow` | Switching on "the author cannot approve their own post" — by hand, or automatically when a second member joins. |
| `max_posts_per_month` | Creating a post. Counted from the usage log for the calendar month (UTC), so deleting a post does not give the allowance back. |
| `max_brands` | Creating a brand. Removing a brand frees a place. |
| `max_members` | Adding a member. |
| `video_uploads` | Uploading a video. Images are always allowed. |
| `max_storage_mb` | Uploading media: what the workspace keeps now plus the new file. Deleting media frees space. |
| `usage_export`, `ai_captions`, `max_ai_tokens_per_month` | Nothing yet — the features they control are not built. |

### What switching a feature off does

It stops **new** use on the customer's next request. It does not undo what already depends on the feature:

- Posts already scheduled or queued still publish — the publish worker does not check features.
- Accounts, brands, members and media over a lowered limit stay; only adding more is refused.
- A workspace that already requires a second approver keeps that rule until the customer switches it off themselves. Losing the feature never silently weakens an approval rule.

### `platform_settings` — every other admin setting

For settings that are not per-plan features, for example "allow public sign-up", "maintenance banner text", "setup link lifetime in hours".

| Column | Type | Notes |
|---|---|---|
| `key` | varchar(100) **PK** | e.g. `signup_enabled`. |
| `value` | JSONB | The current value. |
| `value_type` | varchar(20) | `boolean`, `integer`, `string`, `json` — validated by the API before saving. |
| `description` | text | |
| `updated_by_user_id` | UUID → `users.id`, NULL | |
| `updated_at` | timestamptz | |

Same rule as features: keys and default values are **defined in code** (`app/core/settings_registry.py`) and synced on startup; only the value is changed from the panel.

### `user_setup_tokens` — "set your password" links

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID → `users.id` ON DELETE CASCADE | |
| `token_hash` | varchar(64), unique | **SHA-256 only**, same as refresh tokens. The raw link is shown once in the panel to copy. |
| `purpose` | enum `setup_token_purpose` (`account_setup`, `password_reset`) | |
| `expires_at` | timestamptz | Default 48 hours (from `platform_settings`). |
| `used_at` | timestamptz, NULL | Set when redeemed; a used token can't be used again. |
| `created_by_user_id` | UUID → `users.id`, NULL | The admin who created it. |
| `created_at` | timestamptz | |

Creating a new link for a user deletes their older unused links. Redeeming one is done by the public auth API, not the admin API.

### `usage_daily` — usage counted from real data

Written by a nightly job. This is the independent count that catches limit bugs.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | UUID → `workspaces.id` ON DELETE CASCADE | |
| `day` | date | UTC day. |
| `metric` | varchar(100) | e.g. `posts_created`, `posts_published_facebook`, `media_bytes`, `brands`, `members`, `social_accounts`, later `ai_tokens`. |
| `actual_value` | bigint | Counted from the real tables (`posts`, `publish_jobs`, `post_media`…). |
| `logged_value` | bigint, NULL | Counted from `usage_logs`. A difference = a code path that skips usage logging. |
| `computed_at` | timestamptz | |

Primary key `(workspace_id, day, metric)`. Monthly billing totals are a `SUM` over this table.

### `admin_alerts` — things the owner should look at

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `workspace_id` | UUID → `workspaces.id` ON DELETE CASCADE, NULL | |
| `user_id` | UUID → `users.id`, NULL | |
| `alert_type` | enum `admin_alert_type` | `over_limit`, `usage_mismatch`, `usage_spike`, `repeat_signups`, `high_failure_rate`. |
| `severity` | enum `alert_severity` (`info`, `warning`, `critical`) | |
| `status` | enum `alert_status` (`open`, `acknowledged`, `resolved`) | |
| `details` | JSONB | e.g. `{"metric": "posts_created", "limit": 10, "actual": 40}`. |
| `dedupe_key` | varchar(200) | e.g. `over_limit:<workspace>:posts_created:2026-11`. **Partial unique index** where `status <> 'resolved'`, so the nightly job updates the open alert instead of creating duplicates. |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `resolved_at` | timestamptz, NULL | |
| `resolved_by_user_id` | UUID → `users.id`, NULL | |
| `resolution_note` | text, NULL | |

---

## 3. Database-level protection

The admin API connects with its **own PostgreSQL role**, `omnipost_admin`, so the database itself enforces "content is read-only" even if admin code has a bug. Migration `0006_admin_db_role` creates the role and its grants.

| Tables | `omnipost_admin` can |
|---|---|
| `users` | Read everything **except `password_hash`**; create; change email, name, `is_active`, `platform_role`. **Cannot set a password.** |
| `workspaces` | Read; create; change name, owner, plan, status and suspension fields. Cannot delete, and cannot change the customer's own `allow_self_approval` switch. |
| `workspace_members` | Read; add; change role; remove |
| `refresh_tokens` | Read session details (not the token hash); revoke (force logout) |
| `user_setup_tokens` | Read details (not the token hash); create; delete unused links |
| `plans`, `plan_features`, `caption_templates` | Read; create; change |
| `workspace_feature_overrides` | Read; create; change; delete ("back to plan default") |
| `features` | Read; change **only** the `global_enabled` kill switch |
| `platform_settings` | Read; change the value |
| `admin_alerts` | Read; acknowledge and resolve |
| `audit_events` | Read; add — never change or delete |
| `usage_daily`, `usage_logs` | Read only (written by the app and the nightly job) |
| `brands`, `posts`, `post_media`, `approval_logs`, `publish_jobs` | **Read only** |
| `social_accounts` | Read everything **except the encrypted access and refresh tokens** |

The role is created **without a login**. The admin API reaches it in one of two ways:

- **Default:** it connects as the application's own database user and switches to `omnipost_admin` for the whole connection. Migration `0006` makes the migration user a member of the role so this is allowed. Nothing to configure.
- **Stricter:** create a separate login and set `ADMIN_DATABASE_URL` to it, so the admin API never holds the application user's credentials:

```sql
CREATE ROLE omnipost_admin_app LOGIN PASSWORD '...' IN ROLE omnipost_admin;
```

The migration user must be allowed to create roles (`CREATEROLE`). A table added later gets **no** access for this role until a migration grants it on purpose. `GET /admin/overview` reports the role the API is running as (`database_role`), which should read `omnipost_admin`.

---

## 4. Seed data

The migration creates:

- The `features` rows from the code registry.
- Plans `free` and `pro` with **placeholder** values — the owner sets the real ones from the panel.
- A plan `founding` with every feature on and no limits. **Every existing workspace is put on `founding`, and it is the default plan for new workspaces too**, so nobody is restricted by placeholder numbers. Once the real plan values are set, the owner makes `free` the default and moves customers to real plans from the panel.

The first super admin is created once from the command line (`python -m app.cli grant-super-admin <email>`). After that, staff accounts are created in the panel.

---

## 5. The admin change process (applies to every future admin feature)

Anything that becomes changeable from the admin panel — now or later — follows these rules. A pull request that adds an admin setting is checked against this list.

1. **The value lives in the database.** Never in `.env`, a code constant or the frontend. Changing it must never need a redeploy or a hand-written SQL query.
2. **The definition lives in code.** The list of valid keys, their type and default is a registry in code (`features.py`, `settings_registry.py`), synced to the database on startup. The panel changes values; it can't create keys the code doesn't understand.
3. **Changes go through the admin API only.** One endpoint under `/api/v1/admin/*`, guarded by `require_super_admin` (non-admins get 404). Migrations are for schema and first seed only — never for changing a customer's settings.
4. **One shared rule set.** The logic lives in a service in `app/services/` and is used by both the admin routes and the customer routes, so the same rules apply everywhere.
5. **Every change is audited.** An `audit_events` row with before, after, who, and a **required reason**.
6. **It takes effect immediately.** The backend reads the value at request time (or uses a cache that is cleared on save). The frontend re-reads it on page load, on tab focus, and when the backend reports a change.
7. **The backend is the gate.** The frontend only hides or locks what the backend already blocks.
8. **Customer content stays read-only.** New tables get explicit `omnipost_admin` grants; content tables never get write access.
9. **Tested.** Each admin endpoint has tests for: non-admin is refused, the audit row is written, and the change is visible on the next customer request.

---

## 6. The admin API

Everything is under `/api/v1/admin`. Code: `backend/app/api/v1/admin/`.

- **Who can call it:** a signed-in login whose `platform_role` is `super_admin`. Anyone else gets **404** — for a customer, this API does not exist. The role is read from the database on every request, so removing it works at once.
- **Every change needs a `reason`** (in the body; as `?reason=` on a DELETE). It is stored in `audit_events` with who did it, and — when it concerns a workspace — shows in that customer's own audit log marked as done by platform staff.
- **It cannot change customer content.** There is no route for it, and the database role refuses it.

### The first super admin

Created once, on the server, from the command line — there is no web route that can promote a login without an existing super admin:

```bash
python -m app.cli grant-super-admin owner@example.com
python -m app.cli list-super-admins
```

After that, staff are managed in the panel. Nobody can change their own role, so one super admin always remains.

### Endpoints

| Area | Endpoint | What it does |
|---|---|---|
| Overview | `GET /overview` | Counts: workspaces (by plan, suspended), users, posts, failed and stuck publish jobs |
| Workspaces | `GET /workspaces` | List; search by name or owner email; filter by plan and status |
| | `POST /workspaces` | Create a workspace for an existing login |
| | `GET /workspaces/{id}` | Details with counts |
| | `PATCH /workspaces/{id}` | Rename; **change plan** |
| | `POST /workspaces/{id}/suspend`, `/reactivate` | Make read-only / restore |
| | `POST /workspaces/{id}/transfer-ownership` | Make another member the owner (the old owner stays as admin) |
| Members | `GET` / `POST /workspaces/{id}/members` | List; add an existing login (within the plan's member limit) |
| | `PATCH` / `DELETE /workspaces/{id}/members/{user_id}` | Change role; remove (never the owner) |
| Per-customer features | `GET /workspaces/{id}/features` | What the customer gets, what their plan says, and any override |
| | `PUT /workspaces/{id}/features/{key}` | Set an override: on/off, own limit, optional end date (trial) |
| | `DELETE /workspaces/{id}/features/{key}` | Back to the plan default |
| Logins | `GET /users`, `GET /users/{id}` | List and search; details with workspaces and active sessions |
| | `POST /users` | Create a login — alone, inside a workspace, or with a new workspace of its own. Returns the one-time setup link |
| | `PATCH /users/{id}` | Rename; deactivate / reactivate (deactivating ends every session at once) |
| | `POST /users/{id}/setup-link` | New "set your password" link (also the password reset) |
| | `POST /users/{id}/force-logout` | End every session |
| | `PUT /users/{id}/platform-role` | Make a login platform staff, or a customer login again |
| Plans | `GET /plans`, `POST /plans`, `PATCH /plans/{id}` | List with values and workspace counts; create (optionally copying another plan); rename / retire |
| | `PUT /plans/{id}/features/{key}` | What the plan includes for one feature |
| | `POST /plans/{id}/make-default` | The plan new workspaces start on |
| Global switches | `GET /features`, `PATCH /features/{key}` | Turn a feature off for everyone, or back on |
| Settings | `GET /settings`, `PATCH /settings/{key}` | Platform settings (defined in `app/core/settings_registry.py`) |
| Templates | `GET` / `POST /templates`, `PATCH /templates/{id}` | Manage the Smart Template library; switch a template off |
| Content (read-only) | `GET /workspaces/{id}/posts`, `GET /posts/{id}` | A customer's posts, with media, approval history and publish jobs. **Each view is audited** |
| | `GET /workspaces/{id}/brands`, `/social-accounts` | Brands; connected accounts and their health (never tokens) |
| Usage | `GET /usage`, `GET /workspaces/{id}/usage` | Usage per workspace against its limits; `?problems_only=true`; `?format=csv` to download |
| Audit | `GET /audit` | The audit trail across all workspaces, with filters (`staff_only=true` for staff actions) |

### Creating a login without knowing its password

1. `POST /admin/users` creates the login with no usable password and returns a **setup link** (valid for `setup_link_hours`, default 48).
2. The link is shown once — only its SHA-256 is stored. The admin passes it to the customer. (When email sending exists, the system will send it.)
3. The customer opens it and chooses a password: `POST /api/v1/auth/set-password` with the token. The link works once; a newer link cancels the older one.

A forgotten password is replaced the same way (`POST /admin/users/{id}/setup-link`); using the link ends every existing session.

### A suspended workspace

Its members can still sign in and read everything. Every request that would change something is refused with **403** and the header `X-Plan-Restriction: workspace_suspended`, and publish jobs that come due fail with "The workspace is suspended" instead of posting. Nothing is deleted. After reactivation the customer can retry those posts.

### The usage report: catching a plan that is not being enforced

Each row has two independent counts — the **usage log** (what limits are enforced against) and the **real tables** (what actually exists) — plus the workspace's limits:

- `over_limit` lists the limits the workspace is above. That happens when a limit was lowered after the fact, or when a check is being bypassed.
- `usage_mismatch` is true when the posts table holds more posts for the month than the usage log recorded: some code path created posts without logging them.

`GET /admin/usage?problems_only=true` lists only those workspaces. This is computed on request; the nightly job (not built yet) will store the same checks in `usage_daily` and raise `admin_alerts`.
