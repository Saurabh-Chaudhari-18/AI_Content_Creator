# OmniPost — Complete Product Audit

**Date:** 2026-11-18 · **Scope:** whole repository at `main` @ `0048839` (backend, frontend, database, Docker, tests) · **Environment tested:** local Docker stack (`omnipost` project) and a throwaway `ai_content_test` database. Nothing was run against production; no production exists yet.

> Secrets are never printed in this report. Where a secret-like value was found its location and type are given and the value is redacted.

---

## 1. Executive summary

OmniPost is in **better shape than most MVPs of its size**. The core security design was clearly done deliberately: short-lived JWTs held in memory, an HttpOnly + SameSite=strict rotating refresh cookie, CSRF double-submit, one tenancy choke-point (`get_workspace_member` / `get_brand_access` / `get_post_access`) used by every customer route, Fernet-encrypted OAuth tokens, hashed one-time tokens, magic-byte upload validation, a restricted database role for the admin API, and a publishing pipeline with a commit barrier against double-posting. **No SQL injection, XSS, IDOR across tenants, authentication bypass or committed secrets were found.** The 185 backend tests all pass.

The problems are concentrated in four places:

1. **Publishing correctness under concurrency** — two confirmed code paths can make a scheduled post *never* go out (orphaned job) or go out *twice* (double click / two tabs on "Post right now"). For a product whose promise is "your approved post goes out once, on time", these are the most important findings.
2. **The Docker "one-click" stack is a development stack** — it runs in `ENVIRONMENT=development` with `DEBUG=true`, exposes PostgreSQL (superuser `postgres/postgres`) and an unauthenticated Redis on all interfaces, re-seeds a super-admin account whose password is in the repo on every start, and rate-limits **all users as one IP** because nginx doesn't pass the client address. Fine on a laptop; dangerous if copied to a server.
3. **Out-of-date dependencies** — `pip-audit` reports known CVEs in starlette (via FastAPI 0.115), python-multipart, PyJWT, cryptography and Pillow — several in code paths this app uses directly (multipart uploads, image decoding, JWT).
4. **Production readiness gaps** — no CI, no monitoring/error tracking, no backups, no frontend tests, no error boundary, CPU-bound work (bcrypt, image re-encoding, S3 uploads) running on the API's event loop.

### Scores (0–100)

| Area | Score | Why |
|---|---|---|
| Security | **70** | Strong auth/tenancy design; deductions for vulnerable deps, shared-IP rate limiting, SPA without security headers, secret in logs, dev stack exposure |
| Database | **62** | Sound schema & tenancy; missing composite indexes, no retention, superuser app login, no timeouts, model/migration drift |
| Backend | **72** | Clean layering, consistent guards; concurrency races in state transitions, blocking calls in async handlers |
| Frontend | **66** | Good token handling, lazy routes; no error boundary, misleading empty states, 536 kB main chunk |
| Performance | **55** | Measured: one API process ≈ 330–390 req/s on a no-op route, ~36 req/s on a DB list, logins serialise the whole process |
| Scalability | **50** | Single uvicorn process, no pool sizing vs `max_connections`, unbounded tables & queries |
| Reliability | **58** | Good publish commit barrier; orphaned-job bug, no backups, no alerting, Redis as single point of failure for scheduling |
| Infrastructure | **35** | Dev-mode compose only; no CI/CD, HTTPS, monitoring, backups or prod config |
| UI/UX | **70** | Coherent flows, confirmations on most destructive actions; a few one-click irreversible actions and silent re-approval |
| Accessibility | **62** | Radix primitives, focus rings, good text contrast; keyboard-trapped notification list, destructive-button contrast, incomplete tab pattern |
| Testing | **60** | 185 passing backend tests incl. integration; zero frontend/E2E tests, no concurrency tests, no CI |
| Maintainability | **76** | Readable, well-commented code; small duplication, a few dead UI components |

**Limits of these scores:** they reflect a code audit plus local measurements on one laptop (load generator and server on the same machine). There is no production environment, real traffic, or real Meta/LinkedIn credentials to test against.

### Is it production-ready?

**Not yet — but it is close for a small private beta** once the P0 list (section 13) is done. The P0 items are all small (S or XS effort).

---

## 2. Architecture overview

```
Browser (React SPA, Vite build)          Client (no login)  ──  /a#<token>
        │  Bearer JWT (memory) + HttpOnly refresh cookie
        ▼
nginx (web container :4173)  ── serves SPA, proxies /api and /static
        ▼
FastAPI (api container :8000, ONE uvicorn process)
  ├─ middleware: CORS → RequestID → SecurityHeaders
  ├─ /auth  /workspaces  /brands  /posts  /approvals  /media  /social  /calendar  /templates
  ├─ /public/approval (token in POST body)     /webhooks/meta (signed_request)
  └─ /admin (super admin only; separate pool as DB role omnipost_admin)
        │ asyncpg pool 10+20 (+ admin 3+5)          │ redis.asyncio (rate limits, OAuth state)
        ▼                                            ▼
PostgreSQL 16  ◄──────── psycopg2 pool 5+10 ── Celery worker (concurrency 2)
                                                     ▲ Redis broker
                                              Celery beat (every 60 s: dispatch due jobs,
                                              link expiry, stale assignments; 15 min abuse scan;
                                              hourly stale-job cleanup; 6 h token expiry; daily notif purge)
        Storage: local disk (/static/uploads) in dev, S3/R2 presigned URLs in prod
        External: Facebook Graph API (OAuth + publish), Instagram Graph, LinkedIn (text only)
```

**Critical business flows**
1. Register → workspace → brand → post (draft) → submit (assign manager or client contact) → approve (manager, author ≠ approver unless self-approval) or client approves via link → schedule / post now → Beat dispatches → worker publishes per account → post status derived from jobs.
2. Connect Facebook (OAuth state in Redis) → pages + IG accounts stored with encrypted tokens.
3. Super admin: plans/features/settings, suspend workspaces, setup links, read-only content view.

**Entry points:** 11 customer routers, 7 admin routers, 2 public approval endpoints, 1 OAuth callback, 2 Meta webhooks, 2 health probes, local static uploads, 7 Beat tasks + 1 on-demand publish task.

---

## 3. Critical findings (fix first)

| ID | Title | Sev | Status |
|---|---|---|---|
| **REL-01** | Beat dispatcher can orphan publish jobs → a scheduled post never goes out, silently | HIGH | Confirmed (code path) |
| **BIZ-01** | Concurrent "Post right now" / "Schedule" (double click, two tabs) creates two job sets → **posts twice** | HIGH | Confirmed (code path) |
| **SEC-01** | Rate limiter sees every user as the nginx container IP → 5 failed logins by anyone lock out everyone for 15 min; 120 req/min shared by all users on non-workspace routes | HIGH | **Verified live** (`rl:auth:172.18.0.7`) |
| **SEC-02** | Known-vulnerable dependencies: starlette 0.38.6 (14 advisories), python-multipart 0.0.12 (14), PyJWT 2.10.1 (22), cryptography 44.0.0 (12), Pillow 10.4.0 (69) | HIGH | Verified (`pip-audit`) |
| **INF-01** | Docker stack exposes Postgres (superuser `postgres/postgres`) and password-less Redis on all interfaces; runs `ENVIRONMENT=development`, `DEBUG=true`; re-seeds a super-admin with a repo-published password on every start | HIGH (if deployed as-is) | Verified live |
| **PERF-01** | bcrypt (≈250 ms CPU) runs on the event loop in `login`/`register`/`set-password` → every login freezes the whole API process | HIGH | **Measured**: 10 concurrent logins → 1.1 req/s, p50 6.2 s; other requests stalled behind them |
| **FE-01** | No React error boundary — a failed lazy chunk after a redeploy, or one render error, blanks the whole app | HIGH | Confirmed |

---

## 4. Complete findings register

Legend — Effort: XS <1 h · S 1–4 h · M 4–8 h · L 1–3 d · XL >3 d. Priority: P0 immediate · P1 before release · P2 near-term · P3 long-term. "Confirmed" = demonstrated by code path and/or execution; "Potential" = plausible but not reproduced.

### 4.1 Security

| ID | Title | Sev | Location | Evidence / trigger | Fix | Effort | Pri | Status |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | All clients share one rate-limit bucket behind nginx | HIGH | `frontend/nginx.conf:13`, `app/core/dependencies.py:151`, compose `.env` `TRUST_X_FORWARDED_FOR=false` | nginx sets no `X-Forwarded-For`; limiter key observed live as `rl:auth:172.18.0.7` (web container). 5 bad logins from anyone ⇒ 429 for all users for 15 min. Brand/post routes without `workspace_id` in path fall back to IP ⇒ 120 req/min for the whole user base | nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, never append); compose: `TRUST_X_FORWARDED_FOR=true` | XS | P0 | Verified live |
| SEC-02 | Vulnerable Python dependencies | HIGH | `backend/requirements.txt` | pip-audit: starlette 0.38.6 → fix ≥0.47.2 / 1.x (multipart & request DoS); python-multipart 0.0.12 → 0.0.31; PyJWT 2.10.1 → 2.15.0; cryptography 44.0.0 → 50.0.0; Pillow 10.4.0 → 13.0.0 (image decoder bugs — user uploads go through `Image.open`); pytest (dev only) | Upgrade FastAPI (pulls starlette), python-multipart, PyJWT, cryptography, Pillow; re-run the test suite; add `pip-audit` to CI | S–M | P0/P1 | Verified |
| SEC-03 | Brand owner can make the server delete arbitrary storage keys | MEDIUM | `app/api/v1/brands.py:91-95,123-129`, `schemas.py:224,242` | `brand_guidelines` is a free dict; any member can PATCH `{"brand_guidelines":{"_logo_storage_key":"media/<victim-key>"}}`, then upload a logo → `storage.delete(old_key)` deletes that object (any tenant's file on S3; within `uploads/` on local disk; any absolute path on Windows local storage). Also any PATCH of `brand_guidelines` drops the real key, orphaning the logo file | Reject client keys starting with `_`; keep internal keys server-side on update | S | P0 | Confirmed (code) |
| SEC-04 | Meta app secret written to logs on OAuth failure | MEDIUM | `app/services/meta_oauth.py:91-104`, `social_accounts.py:105` | `exchange_code_for_token` sends `client_secret` as a query parameter and calls `raise_for_status()`; `logger.exception(...)` then logs `HTTPStatusError`, whose message contains the full URL **including `client_secret` and `code`** | Catch `HTTPStatusError`, log status + Meta error code only; or POST the secret in the body | XS | P0 | Confirmed (code + httpx behaviour) |
| SEC-05 | SPA HTML has no security headers (clickjacking of Approve/Publish, no CSP) | MEDIUM | `frontend/nginx.conf:30-34` | Verified live: `/` returns no `X-Frame-Options`, CSP, nosniff or Referrer-Policy (API JSON responses do have them) | Add headers in nginx with `always`; start with `frame-ancestors 'none'`, then a full CSP with the inline theme-script hash | XS–S | P1 | Verified live |
| SEC-06 | Seeded super-admin with known password on every Docker start | HIGH if exposed | `docker-compose.yml:72` (`python -m seeds.seed`), `seeds/seed.py:36,156` | `migrate` service seeds in any non-`production` environment; compose runs `development` | Only seed when an explicit `SEED_DEMO=1`; never in a stack reachable from a network | XS | P0 | Verified |
| SEC-07 | Login timing reveals which emails exist; register says "already exists" | LOW | `auth.py:115-122`, `auth.py:89-92` | No bcrypt work when the user doesn't exist (≈250 ms difference) | Verify against a dummy hash when the user is missing; neutral register response once email verification exists | XS | P2 | Confirmed (code) |
| SEC-08 | Refresh rotation not atomic, no reuse detection; multi-tab refresh logs users out | LOW/MED | `auth.py:186-209`, `frontend/src/lib/api.ts:126-147` | Two concurrent refreshes with one cookie: both may succeed (fork) or the loser's 401 clears the winner's new cookie | `UPDATE … WHERE NOT is_revoked RETURNING`; short grace window for the just-rotated token; cross-tab `navigator.locks` in SPA | S | P1 | Confirmed (code) |
| SEC-09 | No self-service password reset, no email verification, no MFA, no per-account lockout | INFO/MED | `auth.py` | Password reset only via admin-issued link; anyone can register any email | Roadmap: email verification + reset flow; MFA for owners/staff | L | P2 | Confirmed |
| SEC-10 | OAuth state consume is GET-then-DEL (not atomic); state not re-checked against current membership | LOW | `meta_oauth.py:62-69` | Two callbacks with the same state both succeed | `GETDEL`; re-check member role at callback | XS | P2 | Confirmed (code) |
| SEC-11 | Unbounded JSON bodies (`brand_guidelines`, `platform_targets`) and no app-level body limit | LOW | `schemas.py`, `main.py` | Only nginx's 110 MB cap protects; a 100 MB JSON body is parsed into memory | Limit dict size/depth in validators; nginx `client_max_body_size` 1m for non-upload routes | S | P2 | Confirmed (code) |
| SEC-12 | Workspace rate-limit key is taken from the path before membership is checked | LOW | `rate_limit.py:55-66` | Any logged-in user who knows a workspace UUID can exhaust that workspace's 120/min budget | Key on `(user_id)` + workspace after auth | S | P3 | Confirmed (code) |
| SEC-13 | Admin powers exceed "read-only observer" policy | MEDIUM (policy) | `admin/users.py:197-215`, `admin/workspaces.py:246-269`, 0006 grants | Staff get raw password-reset links for any customer and can add their own login to a customer workspace (both audited, not prevented) | Email setup links to the user; refuse adding staff accounts as members; narrow `INSERT` grant on `users` | M | P1 | Confirmed (code + live grants) |
| SEC-14 | Meta data-deletion webhook only deactivates; encrypted tokens and data remain | LOW (compliance) | `webhooks.py:79-91` | Meta policy expects deletion | Null `access_token_encrypted`, schedule deletion, expose status page | S | P2 | Confirmed |
| SEC-15 | `X-Request-ID` echoed unvalidated into logs/headers | INFO | `middleware.py:49` | Log-forging via newlines in some log sinks | Accept only `[A-Za-z0-9-]{1,64}` | XS | P3 | Confirmed |
| SEC-16 | Set-password token in query string | LOW | `SetPasswordPage.tsx:15` | Lands in nginx access logs / history | Move to fragment or `replaceState` | S | P2 | Confirmed |
| SEC-17 | Single Fernet key, no rotation path; PII (contact phone/email) in plaintext | LOW | `services/encryption.py`, `brand_contacts` | — | `MultiFernet`; document key rotation | M | P3 | Confirmed |

**Positive security controls verified:** PyJWT with algorithm allow-list, iss/aud/exp required; bcrypt 12 with 72-byte guard; refresh token hashed, HttpOnly, SameSite=strict, path-scoped; CSRF double-submit on cookie routes; CORS exact origins; 404 for non-members (no ID probing); author ≠ approver separation; content hash verified at approve and again in the worker; cross-tenant account check in worker; upload extension allow-list + magic bytes + EXIF strip + size caps; client links: 256-bit tokens, SHA-256 stored, token in URL fragment and POST body, no-store/no-referrer; webhook HMAC constant-time and refusing empty secret; mock connect disabled in production; no `dangerouslySetInnerHTML`; access token in memory only; no open redirect. `bandit` found only false positives (string constants named like passwords). The `EAAB…` token-like string in git history is a fake fixture in `tests/test_security.py:93`.

### 4.2 Business logic, reliability & concurrency

| ID | Title | Sev | Location | Evidence / trigger | Fix | Effort | Pri | Status |
|---|---|---|---|---|---|---|---|---|
| REL-01 | Orphaned publish jobs | HIGH | `workers/tasks/publish.py:54-68` + `155-164` | Dispatcher holds `FOR UPDATE` row locks while calling `apply_async` for up to 100 jobs and commits only at the end. A worker that receives the task before that commit finds the row locked (`skip_locked`) and exits "locked". The job is then `queued` with `celery_task_id` set — the scan requires `celery_task_id IS NULL` and cleanup only looks at `processing`. **The post stays "scheduled" forever with no error.** Most likely when one post targets several accounts | Commit task ids first, then enqueue (outbox); have a locked task retry instead of exit; sweep `queued` jobs whose task id is older than N minutes | S | P0 | Confirmed (code) |
| REL-02 | Retried jobs lost on broker restart stay orphaned | MEDIUM | `publish.py:128-136` | `task.retry()` is an ETA message in Redis while `celery_task_id` stays set | Same sweep as REL-01 | S | P1 | Potential |
| BIZ-01 | Double publish from concurrent requests | HIGH | `posts.py:623-698` (schedule, publish-now); `dependencies.py:121` | Post is read without a lock; two requests both see `APPROVED`, both insert jobs; no unique constraint on live `(post_id, social_account_id)` jobs; both jobs pass worker guards ⇒ the customer's page gets the post twice. Frontend doesn't disable "Post now" vs "Schedule" against each other | Lock the post row (`FOR UPDATE`) in every state-changing route; partial unique index on live jobs | S | P0 | Confirmed (code) |
| BIZ-02 | "First decision wins" not enforced between manager and client | MEDIUM | `posts.py:406-470` vs `public_approval.py:107` | Client decide locks the post, manager approve doesn't ⇒ approve can overwrite a client's "changes requested" landing at the same moment | Same row lock as BIZ-01 | XS | P0 | Confirmed (code) |
| BIZ-03 | Meta 5xx after a write is treated as retryable → possible double post | MEDIUM | `publishing/facebook.py:25-29` | A 500 from `/feed` can come after the post was created; job retries | Treat 5xx on the final write as `UnknownOutcome` (needs review) | XS | P1 | Potential |
| BIZ-04 | Deleting a post never deletes its media files; quota counts rows not files | MEDIUM | `posts.py:286-308` | Files remain in S3/disk forever (cost + privacy/retention) | Delete storage objects after commit (or a sweeper) | S | P1 | Confirmed (code) |
| BIZ-05 | Deleting a post deletes its approval ledger | LOW | `posts.py:306`, model cascade | "Never deleted" approval history goes with the post | Soft-delete posts | S | P2 | Confirmed |
| BIZ-06 | Media add/remove on approved/scheduled post silently unapproves & unschedules | MEDIUM (UX) | `PostStudioPage.tsx:756-810`, `media.py:100-118` | Save asks for confirmation; media changes don't | Reuse the re-approval dialog | S | P1 | Confirmed |
| REL-03 | Redis is a hard dependency for scheduling, OAuth and rate limiting, and runs without auth | MEDIUM | compose | One container, AOF on, no password | `requirepass`/ACL, managed Redis in prod, health alert | S | P1 | Verified live |

### 4.3 Backend performance

| ID | Title | Sev | Location | Evidence | Fix | Effort | Pri |
|---|---|---|---|---|---|---|---|
| PERF-01 | bcrypt on the event loop | HIGH | `auth.py:117,97,166` → `security.py:24-36` | **Measured:** 10 concurrent logins → 1.1 req/s, p50 6.2 s; list requests immediately after still at 3.7 s | `await run_in_threadpool(verify_password, …)` | XS | P0 |
| PERF-02 | Image re-encode and S3 `put_object` run synchronously in async handlers | MEDIUM | `media.py:46-61,163`, `brands.py:113` | A 25 MB image or 100 MB video blocks the whole process for seconds | `run_in_threadpool` for `_strip_exif` and `storage.save/delete` | XS | P1 |
| PERF-03 | Single uvicorn process, no workers | MEDIUM | `docker-compose.yml:80`, `Dockerfile:22` | **Measured** on the Docker API: `/health` 331 req/s at c=10, falling to ~40–50 req/s at c=100–250 (p95 ≈ 5–6 s) | `--workers N` (or gunicorn+uvicorn workers) sized to CPU and DB pool | XS | P1 |
| PERF-04 | Calendar endpoint unbounded | MEDIUM | `calendar.py:33-52` | No dates ⇒ every post in the workspace with media | Require a window (≤ 3 months) and cap rows | XS | P1 |
| PERF-05 | Webhook loads every active FB/IG account across all tenants | MEDIUM | `webhooks.py:47-54` | Linear in total accounts | Filter in SQL with an index on `platform_metadata->>'fb_user_id'` | S | P2 |
| PERF-06 | Admin overview/usage run ~10–12 platform-wide COUNT/SUM queries per load | MEDIUM | `admin/overview.py`, `admin/content.py:189,264` | Grows with all tenants' data | Use `usage_daily` rollups (table exists, job not built) | M | P2 |
| PERF-07 | Limit checks hold `SELECT … FOR UPDATE` on the workspace row during storage writes | MEDIUM | `services/features.py:156`, `media.py:145-163` | Blocks FK inserts for the tenant while an upload is written | `FOR NO KEY UPDATE` / advisory lock; write file before the lock | XS–S | P2 |

### 4.4 Database (summary — full detail in section 5)

DB-03 admin grants vs policy (=SEC-13) · DB-04 app runs as PostgreSQL superuser (MED) · DB-06 missing composite indexes (MED) · DB-07 no retention: refresh_tokens grow ~48 rows/day per active session, audit/usage/jobs never purged (MED) · DB-09 model/migration drift: `ix_posts_pending_assignee`, `ck_workspaces_link_default_positive` only in migrations; dev `create_all` builds a schema without the admin role (MED) · DB-10 no `statement_timeout`/`idle_in_transaction_session_timeout`; pools (38 per API process + 15 per worker child) vs `max_connections=100` (MED) · DB-12 refresh rotation (=SEC-08) · DB-13 unindexed FKs used by cascades (LOW) · DB-14 locking DDL patterns, 0007 downgrade deletes client approval history (LOW) · DB-15 link row locked before tenancy check (LOW) · DB-18 media file deleted before DB commit; `view_count` lost updates (LOW).

### 4.5 Frontend

| ID | Title | Sev | Location | Fix | Effort | Pri |
|---|---|---|---|---|---|---|
| FE-01 | No error boundary; chunk-load failure after redeploy = blank app; `members.data!` crash | HIGH | `App.tsx:11-23`, `SettingsPage.tsx:177` | Root boundary + per-route `errorElement`; reload once on chunk error | S | P0 |
| FE-02 | Multi-tab refresh logs users out | MED | `api.ts:126-147` | `navigator.locks` (see SEC-08) | S | P1 |
| FE-03 | API errors shown as empty states ("You're all caught up") | MED | Home, Posts, Calendar, Accounts, Templates, Brands | Shared loading/error/empty component | M | P1 |
| FE-04 | Media change silently un-approves (=BIZ-06); Remove has no pending guard | MED | `PostStudioPage.tsx:756-810` | Confirm + disable | S | P1 |
| FE-05 | Notification list not keyboard reachable | MED | `NotificationBell.tsx` | Popover or `DropdownMenuItem asChild` | S | P1 |
| FE-06 | SPA security headers (=SEC-05) | MED | `nginx.conf` | — | XS | P1 |
| FE-07 | No unsaved-changes guard in Post Studio | MED | `PostStudioPage.tsx:161` | `useBlocker` + `beforeunload` | S | P2 |
| FE-08 | "Post right now" publishes with one click; Post-now and Schedule not mutually disabled | MED | `PublishPanel.tsx:433-439` | Confirm dialog listing accounts | XS | P0 (pairs with BIZ-01) |
| FE-09…26 | Non-JSON error bodies (413/502) → generic message; workspace name saved to wrong workspace after switch; pager not reset; role gating defaults; inconsistent cache invalidation; "due soon" polling stops; publish-panel NaN date; revoke/cancel-schedule/template-replace without confirm; one-time link lost on Esc; contrast (white on dark destructive 3.9:1, input borders 1.4:1); client page URIError on bad `%`; 536 kB main chunk; Home fires ~10 requests and memo never hits; template search per keystroke; test-account button shown in prod; incomplete ARIA tabs; fixed decision bar may cover content on small phones | LOW | see frontend agent detail in section 10 | individual XS–S fixes | XS–S each | P2 |

### 4.6 Infrastructure

| ID | Title | Sev | Evidence | Fix | Effort | Pri |
|---|---|---|---|---|---|---|
| INF-01 | Postgres & Redis published on `0.0.0.0` with default creds / no auth | HIGH (network-exposed) | compose `ports: "5432:5432"`, `"6379:6379"`; live `requirepass` empty | Bind to `127.0.0.1`; Redis password; strong DB password from env | XS | P0 |
| INF-02 | App connects as PostgreSQL superuser | MED | compose `DATABASE_URL postgres:postgres` | Dedicated least-privilege app role; migrations as owner role | S–M | P1 |
| INF-03 | Docker stack runs dev mode (`DEBUG=true`, docs on :8000, mock connect, `create_all`) | MED | live `printenv` | Separate `docker-compose.prod.yml` with `ENVIRONMENT=production` | S | P1 |
| INF-04 | No CI/CD | MED | no `.github/`, no pipeline | GitHub Actions: ruff, pytest (with Postgres/Redis services), tsc, eslint, vite build, pip-audit, npm audit | S | P1 |
| INF-05 | No monitoring, error tracking, alerting or structured logs | MED | no Sentry/metrics deps | Sentry (API, worker, SPA), uptime check on `/ready`, alert on queued-job age and failed jobs | M | P1 |
| INF-06 | No backups / restore drill | HIGH for prod | named volume only | Managed Postgres with PITR, or nightly `pg_dump` off-host + quarterly restore test | S–M | P1 |
| INF-07 | No HTTPS / HSTS in the stack; `COOKIE_SECURE=false` | MED (prod) | compose | TLS-terminating proxy (Caddy/ALB); production guards already enforce COOKIE_SECURE | S | P1 |
| INF-08 | `minio/minio:latest` unpinned; no container healthchecks for api/worker/beat; nginx `server_tokens` on | LOW | compose, nginx | Pin images, add healthchecks, `server_tokens off` | XS | P2 |
| INF-09 | Single beat & worker are single points of failure; beat schedule in `/tmp` | LOW | compose | Restart policies (`restart: unless-stopped`), alert on dispatch lag | XS | P2 |

---

## 5. Database report

**Live state:** head `0007_client_approval_links`; indexes match migrations; database nearly empty, so EXPLAIN plans were not meaningful — index recommendations come from query shapes.

**Tables (21):** users, refresh_tokens, workspaces, workspace_members, brands, posts, post_media, approval_logs, social_accounts, publish_jobs, usage_logs, caption_templates, audit_events, plans, features, plan_features, platform_settings, workspace_feature_overrides, user_setup_tokens, usage_daily, admin_alerts, brand_contacts, approval_links, notifications. All timestamps are `timestamptz`; enums store lowercase values; tenancy is via `workspace_id` everywhere except `posts` (through `brands`).

**Index recommendations (create `CONCURRENTLY`):**
- `usage_logs (workspace_id, operation, created_at)` — monthly post limit on every post create; admin overview
- `posts (brand_id, created_at DESC)`; consider adding `posts.workspace_id` + `(workspace_id, updated_at DESC)` for the dashboard list
- `posts (scheduled_at)`, `posts (published_at)` — calendar
- `audit_events (created_at DESC)`, `(workspace_id, created_at DESC)`
- `approval_links (created_at)`; `approval_logs (action, created_at)`
- partial `publish_jobs (scheduled_for) WHERE status='queued' AND celery_task_id IS NULL` — dispatcher
- partial **unique** `publish_jobs (post_id, social_account_id) WHERE status IN ('queued','processing')` — double-publish backstop
- FKs used by cascades: `notifications.post_id`, `approval_logs.approval_link_id`, plus `posts.created_by`, `workspaces.owner_id`

**Most expensive / dangerous queries:** (1) dispatcher lock-then-enqueue `publish.py:54-68`; (2) unlocked status check → job insert `posts.py:623-698`; (3) admin usage report `admin/content.py:189,264`; (4) webhook cross-tenant scan `webhooks.py:47-54`; (5) unbounded calendar `calendar.py:33-52`; (6) admin audit COUNT+OFFSET `admin/audit.py:51-54`; (7) admin overview counts; (8) storage SUM under workspace lock `media.py:145-159`; (9) OFFSET + COUNT pagination on post lists; (10) stale-assignment sweep every 60 s (fine today).

**N+1:** none significant — list endpoints use `selectinload`. **Pagination:** posts/notifications/admin lists are paginated (OFFSET, fine to ~100k rows; switch to keyset later); calendar and brand/contacts lists are not.

**Scalability by size:**
- *1k users / 10k posts:* fine everywhere.
- *10k users / ~1M posts and usage rows:* post-create limit check, admin overview, audit log listing and calendar degrade to seconds without the indexes above; refresh_tokens reaches millions of rows.
- *100k users:* needs indexes, retention, PgBouncer, rollups (`usage_daily`), multiple API processes, and partitioning of `audit_events`/`usage_logs` by month.

**Reliability:** transactions are short and explicit; `worker_session` commits/rolls back correctly; SKIP LOCKED used properly except REL-01. No backups, no `statement_timeout`. Migration 0007's downgrade permanently deletes client/system approval history.

---

## 6. API report — endpoint audit matrix

Auth: **U** = Bearer user, **M** = workspace membership checked, **R** = role check (O/A = owner/admin), **SA** = super admin, **P** = public. RL: **W** = per-workspace/IP limiter, **A** = per-IP auth limiter, **L** = public link limiter.

| Endpoint | Auth | Validation | RL | Paging | Notes |
|---|---|---|---|---|---|
| POST /auth/register, /login, /set-password | P | Pydantic, pw 8–72 B | A (shared IP — SEC-01) | – | bcrypt on loop (PERF-01); enumeration (SEC-07) |
| POST /auth/refresh, /logout | cookie + CSRF | – | none | – | non-atomic rotation (SEC-08) |
| GET/PATCH /auth/me | U | enum | none | – | ok |
| GET/POST /workspaces, GET/PATCH /workspaces/{id} | U, M, R(O/A; self-approval O) | ok | W | no (small) | ok |
| GET /workspaces/{id}/usage, /features, /members; POST /members | U, M, R for add | ok | W | members unpaged | escalation guards correct |
| GET/POST /workspaces/{id}/brands; GET/PATCH/DELETE /brands/{id}; POST /brands/{id}/logo | U, M; delete R(O/A) | `brand_guidelines` unbounded | W (IP fallback) | no | SEC-03; any member edits brands; deactivated brand still editable |
| GET /brands/{id}/posts, /workspaces/{id}/posts | U, M | ok | W | OFFSET | ok |
| POST /brands/{id}/posts; GET/PATCH/DELETE /posts/{id} | U, M; delete author or O/A | ok | W | – | any member edits any post (by design?) |
| POST /posts/{id}/submit, /withdraw, /approve, /reject | U, M, R(O/A) for decide | ok | W | – | no row lock (BIZ-01/02) |
| POST /posts/{id}/validate, /schedule, /publish-now, /retry; DELETE /posts/{id}/schedule; GET /history, /jobs | U, M | ≥1 account, ≤20 | W | – | no row lock; any member may publish approved posts |
| /posts/{id}/approvers, /assignee, /approval-links, /approval-links/{id} (+resend) | U, M, R where needed | ok | W | – | link locked before tenancy check (DB-15) |
| /brands/{id}/contacts (CRUD) | U, M, R(O/A) | ok | W | no | ok |
| /workspaces/{id}/notifications (+unread-count, read, read-all) | U, M, own rows | ok | W | yes | ok |
| POST /public/approval/view, /decide | P (token) | token ≤200 | L + per-link | – | well designed |
| POST /media/upload; PATCH /media/reorder; DELETE /media/{id} | U, M | magic bytes, size | **none** | – | sync CPU/IO on loop (PERF-02) |
| GET /social/workspaces/{id}/accounts; POST connect/facebook, connect/mock; DELETE /social/accounts/{id} | U, M, R(O/A) | ok | W | no | mock disabled in prod only |
| GET /social/callback/facebook | P (state) | – | W (IP) | – | secret in logs (SEC-04); GET-then-DEL state |
| POST /webhooks/meta/deauthorize, /data-deletion | P (HMAC) | – | none | – | cross-tenant scan (PERF-05); no replay window |
| GET /workspaces/{id}/calendar | U, M | dates optional | W | **none** | PERF-04 |
| GET /templates, /templates/{id} | U | ok | none | no | ok |
| GET /health, /ready | P | – | none | – | /ready leaks component names only — fine |
| /admin/* (overview, workspaces, users, plans, features, settings, templates, content, usage, audit) | SA (404 otherwise), restricted DB role | reason required for writes | none | yes | heavy aggregates (PERF-06); policy gap (SEC-13) |

Error handling: `DataError`→422, `IntegrityError`→409 without echoing DB messages; no stack traces leak (`DEBUG` only affects log level). HTTP status codes are consistent.

---

## 7. Security report

See 4.1 for every confirmed and potential issue. Tools run: **pip-audit** (6 vulnerable packages, 133 advisories in total, 1 dev-only), **npm audit** (4 high in `picomatch` via Vite — build-time only, not shipped to browsers), **bandit** (6 low, all false positives), manual git-history secret scan (no real secrets; `.env` correctly ignored and never committed), live header and rate-limit probes. **Not run:** OWASP ZAP active scan (would hammer the shared-IP rate limiter and pollute the dev DB; recommended once SEC-01 is fixed, against a dedicated staging stack), Semgrep, real Meta OAuth.

---

## 8. Performance report (measured)

Environment: Windows 11 laptop; load generator (Python httpx) on the **same machine** — absolute numbers are pessimistic, trends are reliable.

| Scenario | c=10 | c=50 | c=100 | c=250 |
|---|---|---|---|---|
| Docker API `/health` (no DB) | 331 rps · p50 19 ms · p95 89 ms | 145 rps · p95 1.0 s | 38 rps · p95 4.8 s | 47 rps · p95 6.4 s · 0.5 % errors |
| Local API `/health` | 389 rps · p95 25 ms | 134 rps · p95 1.1 s | 118 rps · p95 3.4 s | 88 rps · p95 5.7 s |
| Authenticated post list (DB, 20 rows + media) | 36 rps · p50 111 ms · p95 393 ms · p99 3.7 s | collapsed | collapsed | collapsed |
| Login (bcrypt 12) | **1.1 rps · p50 6.2 s** | 0.4 rps · p50 33 s | – | – |

Zero 5xx errors at any level; the system degrades by queueing, and recovered once load stopped (but requests right after the login burst still took 3.7 s). **Bottlenecks in order:** bcrypt on the event loop → single uvicorn process → BaseHTTPMiddleware ×2 per request → OFFSET+COUNT list queries → test-machine CPU shared with the load generator.

**Realistic capacity today (one API process):** ~20–30 active users clicking around comfortably; a burst of 10 people signing in at once (e.g. Monday morning) visibly freezes the app for everyone for several seconds.

## 9. Traffic & scalability report

- **10 concurrent users:** fine once PERF-01 is fixed.
- **50:** needs `--workers 4` (≈4× throughput on a 4-core box) and SEC-01 fixed (otherwise everyone shares 120 req/min and gets 429s).
- **100–250:** 2+ API containers behind a load balancer, PgBouncer (pools already add up to ~68 connections for one API + one worker), indexes from section 5, Redis with auth & persistence, Sentry.
- **Publishing load:** worker concurrency 2 with 30 s HTTP timeouts and Instagram's container polling (sleep loop) means ~2 posts in flight; 100 posts scheduled for 9:00 take several minutes to drain. Raise concurrency (I/O bound) and monitor queued-job age.
- **Spike recovery:** no crash, no errors; latency recovers after the queue drains. No back-pressure or load shedding exists.

## 10. UI/UX report

**Inventory:** `/login`, `/register`, `/set-password`, `/a#token` (client approval), `/` Home, `/posts`, `/posts/new`, `/posts/:id` (Post Studio: editor, media, templates, approval panel, reviewer/link dialogs, publish panel, certificate), `/calendar`, `/templates`, `/accounts`, `/brands` (+ logo, contacts dialog), `/settings`, `/admin/*` (11 screens: overview, workspaces, workspace detail, users, user detail, plans, features, settings, templates, usage, audit). All routes except login/register are lazily loaded.

**Works well:** consistent design tokens (obsidian + indigo), confirm dialogs on delete post / disconnect / remove brand / remove contact, toasts on success/error, responsive rail → phone header + bottom bar, calendar agenda view on phones, admin tables collapse to labelled blocks, Radix dialogs trap focus, text contrast passes AA in both themes.

**Fix list (from FE findings):** error boundary (FE-01); real error states instead of empty states (FE-03); confirm "Post right now" and media changes on approved posts (FE-08, FE-04); unsaved-changes guard (FE-07); keyboard-accessible notifications (FE-05); confirmations for revoke link / cancel schedule / replace caption with template (FE-17); keep one-time links on screen until explicitly closed (FE-18); destructive button colour `#e5484d` → ~`#c62a2f` and stronger input borders (FE-19); hide "Add a test account" in production (FE-24); consistent "Admin" vs "Manager" naming (FE-24).

**Responsive check:** code-level review at 320–1920 px found no fixed-width overflow outside scroll containers; one risk on the client page's fixed decision bar at 320–414 px with keyboard open (FE-26). **Not done:** browser-rendered screenshots at each width and a screen-reader pass — recommended next step.

## 11. Infrastructure report

See 4.6. Single points of failure: one API process, one worker, one beat, one Redis, one Postgres volume with no backup. Failure behaviour: API crash → Docker doesn't restart it (no `restart:` policy); DB down → `/ready` returns 503 but nothing watches it; Meta outage → jobs retry 3× with backoff then fail visibly (good); Redis down → rate limiting fails open (by design), OAuth connect and all scheduling stop; deployment → new SPA build breaks open tabs (FE-01).

**Recommended monitoring:** API 5xx rate and p95; `/ready`; age of the oldest `queued` publish job (catches REL-01); count of `failed`/`needs_review` jobs per hour; Celery worker heartbeat; Postgres connections vs max; Redis memory; disk/S3 usage; Sentry for API, worker and SPA.

## 12. Test coverage report

- **Executed:** `pytest` — **185 passed** (unit + DB-backed integration against real Alembic migrations: auth, tenancy, approvals, client links, plan features, admin API, publishing worker guards, content hash, validation).
- **Missing:** concurrency tests (double publish, dispatcher race, approve vs client decide), refresh-token rotation races, rate-limit-behind-proxy test, storage key safety, any frontend unit/component test, any E2E (Playwright) test, load test in CI, migration up/down test, accessibility (axe) checks.
- **Test plan (priority order):** (1) regression tests for each P0 fix; (2) Playwright smoke: register → brand → post → submit → approve → post now (mock account) → published, plus client-link approve; (3) Vitest for `api.ts` refresh/CSRF logic and Post Studio guards; (4) axe in Playwright on every route; (5) k6 script for login/list/publish in staging.

---

## 13. Remediation roadmap

**P0 — immediate (all small)**

| # | Item | Findings | Effort |
|---|---|---|---|
| 1 | Fix dispatcher orphaning + add stale-queued sweep | REL-01, REL-02 | S |
| 2 | Row-lock posts on state changes (+ confirm "Post right now" in UI) | BIZ-01, BIZ-02, FE-08 | S |
| 3 | Pass real client IP through nginx and trust it | SEC-01 | XS |
| 4 | Move bcrypt (and image/S3 work) off the event loop | PERF-01, PERF-02 | XS |
| 5 | Stop clients writing internal `_` keys into `brand_guidelines` | SEC-03 | S |
| 6 | Don't log URLs carrying the Meta secret | SEC-04 | XS |
| 7 | Bind Postgres/Redis to localhost; gate demo seeding | INF-01, SEC-06 | XS |
| 8 | Upgrade vulnerable dependencies and re-run tests | SEC-02 | S–M |
| 9 | Add a React error boundary | FE-01 | S |

**P1 — before first real customers:** SPA security headers (SEC-05); atomic refresh + multi-tab lock (SEC-08/FE-02); admin powers vs policy (SEC-13); production compose + HTTPS (INF-03/07); least-privilege DB role (INF-02); CI (INF-04); Sentry + alerts (INF-05); backups (INF-06); uvicorn workers (PERF-03); calendar window (PERF-04); delete media files with posts (BIZ-04); 5xx after write = unknown outcome (BIZ-03); error states (FE-03); media-change confirmation (FE-04/BIZ-06); keyboard notifications (FE-05); Redis auth (REL-03); statement timeouts & pool sizing (DB-10).

**P2 — near term:** indexes (DB-06); retention jobs (DB-07); model/migration drift (DB-09); email verification + self-service reset (SEC-09); OAuth state GETDEL (SEC-10); body size limits (SEC-11); webhook SQL filter (PERF-05); admin rollups (PERF-06); workspace lock type (PERF-07); soft-delete posts (BIZ-05); remaining FE LOW items; data-deletion compliance (SEC-14).

**P3 — long term:** keyset pagination; `posts.workspace_id` denormalisation; partition audit/usage tables; MultiFernet/KMS; per-user rate limits (SEC-12); bundle splitting (FE-21).

## 14. Production readiness checklist

- [ ] All P0 items done and covered by tests
- [ ] Dependencies upgraded; `pip-audit` / `npm audit --omit=dev` clean in CI
- [ ] `ENVIRONMENT=production`, `DEBUG=false`, `COOKIE_SECURE=true`, strong `SECRET_KEY` and `FERNET_KEY` from a secret manager
- [ ] HTTPS everywhere, HSTS, SPA security headers + CSP
- [ ] `TRUST_X_FORWARDED_FOR` correct for the real proxy chain
- [ ] Postgres: non-superuser app role, TLS, PITR backups, restore tested, `statement_timeout`
- [ ] Redis: password/ACL, persistence, not publicly reachable
- [ ] S3/R2 storage with private bucket and lifecycle rules
- [ ] No demo seed; super admin created deliberately
- [ ] API runs ≥2 processes; restart policies; health checks wired to the orchestrator
- [ ] Sentry (API/worker/SPA), uptime check, alerts on queued-job age and failure rate
- [ ] CI: lint, type-check, tests, build, audit on every PR
- [ ] Playwright smoke test of the publish journey green
- [ ] Meta app review: deauthorize & data-deletion endpoints live and compliant
- [ ] Privacy policy, data retention and deletion process documented

## 15. Recommended architecture improvements

Keep the current architecture — a modular monolith (FastAPI + Celery + Postgres + Redis) is right for this product and stage; **no microservices are needed**. Targeted changes:
1. A transactional **outbox** for job dispatch (commit first, enqueue after) — fixes REL-01 permanently.
2. **Optimistic concurrency** on posts (`version_number` already exists — use it in `UPDATE … WHERE version_number = :v`) alongside row locks.
3. **Run CPU-bound work in threads** consistently (`run_in_threadpool`) and run several uvicorn workers.
4. **`usage_daily` rollup job** for admin dashboards and plan limits.
5. A **production compose / IaC** separate from the dev one-click stack.
6. A **single dashboard endpoint** for Home to cut ~10 requests to 1.

---

## 16. Remediation log — P0 (2026-11-18)

| # | Finding | What changed | Files | Regression risk | Test |
|---|---|---|---|---|---|
| 1 | REL-01, REL-02 | Dispatcher now claims jobs (commits a pre-generated task id, releasing row locks) **before** sending messages; send failures are logged, not fatal. New sweep re-dispatches `queued` jobs whose task never started 15 min after they were due. Retries set `scheduled_for` to the retry time (so a pending retry is never swept) and now really back off (60 s → 15 min, jitter) — the decorator's `retry_backoff` was ignored by manual `task.retry()` | `workers/tasks/publish.py` | A message delayed >15 min in a backlogged queue is sent twice; the task's row lock and status guards make the second delivery a no-op | `test_audit_p0.py::test_dispatcher_commits_the_task_id_before_sending`, `::test_lost_message_is_dispatched_again_but_pending_retry_is_not` |
| 2 | BIZ-01, BIZ-02, FE-08 | `get_post_access` locks the post row (`FOR UPDATE OF posts`) on every write request, so status checks and changes are serialised. "Post right now" asks for confirmation listing the accounts; Schedule and Post-now are disabled while either is sending; an emptied date no longer counts as valid | `core/dependencies.py`, `frontend/src/pages/posts/PublishPanel.tsx` | Two writes to the **same post** now wait for each other (milliseconds; a media upload holds the lock while the file is read) | `test_audit_p0.py::test_publish_now_waits_for_and_respects_a_concurrent_change` |
| 3 | SEC-01 | nginx overwrites `X-Forwarded-For` with the real client address; the API container sets `TRUST_X_FORWARDED_FOR=true`. The API port is now bound to 127.0.0.1 so the header can't be spoofed by calling the API directly | `frontend/nginx.conf`, `backend/docker-compose.yml` | Needs `docker compose up -d --build` to take effect | Config — verify after rebuild: `rl:auth:*` keys show the browser's IP |
| 4 | PERF-01, PERF-02, SEC-07 | bcrypt hash/verify run in a worker thread; unknown emails still pay one bcrypt check (no timing leak). Image re-encoding and storage save/delete run in a thread | `core/security.py`, `api/v1/auth.py`, `api/v1/media.py`, `api/v1/brands.py` | None expected | `test_audit_p0_unit.py::test_password_check_does_not_block_the_event_loop`, `::test_unknown_account_still_costs_a_bcrypt_check` |
| 5 | SEC-03, SEC-11 (partial) | Client keys starting with `_` are dropped from `brand_guidelines`; server keys are preserved on update; the logo upload deletes only keys under `brands/<id>/`; guidelines capped at 20 KB | `schemas/schemas.py`, `api/v1/brands.py` | A client that sent its own `_`-prefixed keys loses them (none do) | `test_audit_p0_unit.py::test_brand_guidelines_drop_server_owned_keys`, `test_audit_p0.py::test_brand_guidelines_cannot_point_logo_delete_at_another_file` |
| 6 | SEC-04 | OAuth failures are logged as status + Meta error code/type/message only — never the URL or traceback | `services/meta_oauth.py`, `api/v1/social_accounts.py` | Less detail in logs (no traceback) for OAuth failures | `test_audit_p0_unit.py::test_meta_error_description_never_contains_the_url_secret` |
| 7 | INF-01, SEC-06 (partial) | Postgres, Redis, MinIO and the API publish on 127.0.0.1 only (the web app on 4173 stays reachable from your Wi-Fi). Demo seeding is gated by `SEED_DEMO` (default 1 for the local one-click; set 0 anywhere others can reach) | `backend/docker-compose.yml` | Tools on *other* machines can no longer reach the DB/Redis/API directly | `docker compose config` validated |
| 8 | SEC-02 | FastAPI 0.115.0→0.163.2 (Starlette 0.38→1.10), uvicorn 0.30.6→0.54.0, python-multipart 0.0.12→0.0.34, PyJWT 2.10.1→2.15.1, cryptography 44.0.0→50.0.2, Pillow 10.4.0→13.0.0, pytest 8.3.3→9.2.0, pytest-asyncio 0.24.0→1.5.0 | `backend/requirements.txt` | Major framework jump — see test results | Full suite on the upgraded set |
| 9 | FE-01 | Root and per-screen error boundaries; a missing code file after a deploy reloads once automatically; per-screen boundary resets on navigation. Settings no longer crashes when the team list fails to load | `frontend/src/components/ErrorBoundary.tsx`, `App.tsx`, `pages/SettingsPage.tsx` | None expected | `tsc -b` and ESLint clean; checked in the browser |

Not addressed in P0 (still open, see roadmap): partial unique index on live publish jobs (DB backstop for BIZ-01), SPA security headers (SEC-05), production compose (INF-03), everything P1–P3.

## Audit progress checklist

| Area | Status |
|---|---|
| Repository structure, architecture, data flow | ✅ Audited |
| Auth, sessions, JWT, CSRF, rate limiting | ✅ Audited + live probe |
| Authorization & tenant isolation (all routers) | ✅ Audited (code) |
| Publishing pipeline, workers, Beat tasks | ✅ Audited (code) |
| Public approval links, webhooks, OAuth | ✅ Audited (code); real Meta flow not testable |
| Database schema, indexes, queries, grants | ✅ Audited (code + live catalog, read-only) |
| Frontend code, bundle, a11y (static) | ✅ Audited; build/tsc/lint run |
| Dependency & secret scanning | ✅ pip-audit, npm audit, bandit, git history |
| Backend tests | ✅ Executed: 185 passed |
| Load testing | ✅ Local, c=10–250 (same-machine limitation) |
| Browser-rendered responsive & screen-reader testing | ⚠️ Not done — code review only |
| OWASP ZAP / DAST | ⚠️ Not run — needs a dedicated staging stack |
| Production infrastructure, backups, DNS, CDN, WAF | ⚠️ Not applicable — no production environment exists |

Side effects of the audit on your machine: one failed login against `localhost:4173` (counts 1 of 5 in the shared limiter for 15 minutes), the test suite recreated the `ai_content_test` database, and a few load-test users/posts were added to `ai_content_test`. Your dev database `ai_content` was not written to.
