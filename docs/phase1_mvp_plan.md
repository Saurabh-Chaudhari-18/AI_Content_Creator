# Phase 1 MVP Plan (no AI integration)

Derived from the owner's *Product Development & Delivery Roadmap* (sections 4–5, 10) and
adjusted for two facts: (1) AI generation is deferred to Phase 2, and (2) the backend
is already built and reviewed, so Phase 1 is mostly frontend + integration + deployment.

**Phase 1 goal (owner's words, minus AI):** a stakeholder can sign in, set up a brand,
create a post with manual content, submit and approve it, schedule it to a connected
social account, and see the publishing outcome — including a useful error when it fails.

---

## 1. Owner's MVP scope table → what we deliver

| Owner's area | Owner's "included in MVP" | Phase 1 delivery (no AI) | Backend status |
|---|---|---|---|
| Web application | Responsive web UI, basic sign-in, protected workspace | Login/register, refresh-token session, workspace shell, brand switcher | Done (`/auth/*`, `/workspaces`) |
| Brand setup | Name, industry, audience, tone, language, optional logo | Brand create/edit form, logo upload, brand list | Done (`/brands`); logo upload uses `logo_url` — needs a small upload endpoint (see §4) |
| AI content studio | Generate/edit captions, hashtags, CTA, ideas | **Replaced by Smart Templates**: pick a template filtered by brand industry/category, fill `{{placeholders}}`, edit caption, hashtags, CTA by hand | Done (`/templates`, seed data) |
| Visual content | AI image gen or provider; upload/select; carousel + preview | **Upload only** (JPG/PNG/WEBP/GIF/MP4/MOV/WEBM), drag-to-reorder carousel, per-platform preview. No AI image generation | Done (`/media/upload`, delete); **reorder endpoint missing** (§4) |
| Platform-specific content | Variants + format validation per platform | Per-platform caption/hashtag override tab; pre-publish validation panel (char limits, IG needs image, LinkedIn text-only in MVP) | `platform_targets` column exists but **adapters ignore it**; **validate endpoint missing** (§4) |
| Approval | Draft → approve with explicit action | Submit, Approve, Reject (with reason), Withdraw; approval history ("Approval Evidence") panel | Done, incl. content-hash lock |
| Publishing | Connect accounts validated in Week 1; schedule + publish | Connect Facebook (real OAuth) + Instagram via FB page; LinkedIn mock-only unless OAuth is added; schedule / publish-now; per-platform job status | Done; **LinkedIn OAuth not built** (decision §6) |
| Content calendar | Scheduled-post list / calendar with status | Month + list view, status colours, filter by brand | Done (`/calendar`) |
| Basic usage tracking | Record AI usage for future credits | `usage_logs` records post_created / media_uploaded / post_published; `ai_generation` enum reserved; usage summary screen | Table done; **summary endpoint missing** (§4) |
| Demo & deployment | Review environment, demo, known-limitations doc | Hosted review env (API + worker + beat + Postgres + Redis + S3-compatible), seeded demo workspace, limitations doc | docker-compose done; **hosting not chosen** (decision §6) |

Explicitly **out** of Phase 1 (per the owner's "boundary" column + no-AI constraint): AI text/image generation, enterprise SSO/org admin, advanced brand libraries, multi-level approvals, bulk scheduling, calendar analytics, billing/credits, video generation, design tools.

---

## 2. MVP user journey (owner's §4) → screens and API calls

| # | Owner's journey step | Screen | API |
|---|---|---|---|
| 1 | Sign in, create brand profile | Login / Register → Brands → New Brand | `POST /auth/login`, `GET /workspaces`, `POST /workspaces/{id}/brands` |
| 2 | Provide objective, select platform, request content | **Post Studio**: pick brand → pick Smart Template (by industry/category) → fill placeholders → choose target platforms | `GET /templates?industry=…`, `POST /brands/{id}/posts` |
| 3 | Review/edit caption and visual, save draft | Same screen: caption, hashtags, CTA, upload media, reorder carousel, per-platform preview, per-platform overrides | `PATCH /posts/{id}`, `POST /media/upload`, `PATCH /media/reorder` *(new)* |
| 4 | Submit for approval; explicitly approve selected version | Post detail → Submit → Approve/Reject; version + hash shown | `POST /posts/{id}/submit`, `/approve`, `/reject`, `/withdraw`, `GET /posts/{id}/history` |
| 5 | Choose publishing time and account | Schedule modal: datetime (tz-aware), pick connected accounts, pre-publish validation | `POST /posts/{id}/validate` *(new)*, `POST /posts/{id}/schedule` or `/publish-now` |
| 6 | System publishes in background, shows outcome + useful error | Post detail → Publish Jobs panel; Calendar status; Connections page with token-expiry and reconnect | `GET /posts/{id}/jobs`, `GET /social/workspaces/{id}/accounts`, `DELETE /posts/{id}/schedule` |

Screens list (11): Login, Register, Workspace shell (nav + brand switcher), Brands list, Brand form, Posts list (per brand, status filter), Post Studio (create/edit), Post detail (approval + jobs + evidence), Calendar, Connections (social accounts + connect + health), Usage summary. Plus Members list (read-only; add member exists, remove/role-change deferred).

---

## 3. Owner's acceptance criteria → how we prove each

| Acceptance criterion (owner §4) | Evidence we will show |
|---|---|
| Stakeholders complete the end-to-end journey in the review environment | Scripted demo on the hosted env with a seeded brand; stakeholder does it themselves on a second account |
| Unapproved content cannot be published through the normal workflow | Schedule/publish-now buttons disabled unless `approved`; API returns 400 otherwise; worker re-verifies the approval hash (`test_content_hash.py`, worker guard) |
| Publishing status recorded; failures reported, never silently lost | Per-platform `publish_jobs` with `queued → processing → completed/failed/needs_review`; Beat dispatcher is the safety net; failure shows error text in UI; `needs_review` shows "verify on platform" |
| Workspace data and credentials protected | Tenancy via `get_workspace_member`/`get_post_access`; tokens Fernet-encrypted and never returned by any endpoint; HttpOnly refresh cookie; CSRF on cookie routes |
| Platform limitations documented, not misrepresented | `docs/known_limitations.md` written in Week 4 (see §7 for the known list today) |

---

## 4. Backend work for Phase 1 — DONE (commit after `08f0925`)

All gaps between the backend and the Phase 1 scope are closed. The frontend can build against these from day one.

| Item | Endpoint / behaviour | Notes for the frontend |
|---|---|---|
| Platform-specific content | `platform_targets` = `{"instagram": {caption?, hashtags?, cta?}, ...}` on create/PATCH. Omitted field inherits from the post; explicit `null` clears it for that platform. Adapters publish the resolved variant. Overrides are part of the approval hash. | Per-platform tab in Post Studio; editing an override after approval resets to draft like any other edit |
| Pre-publish validation | `POST /posts/{id}/validate` `{social_account_ids}` → per account: `ok`, `errors[]`, `warnings[]`, `rendered_text`, `character_count`, `character_limit` | Call before showing the Schedule button enabled; show `rendered_text` as the preview |
| Carousel order | `PATCH /media/reorder` `{post_id, media_ids[]}` (must list every media item exactly once). Order is not part of the hash. | Drag-to-reorder |
| Brand logo | `POST /brands/{id}/logo` (multipart `file`, images only) → `{logo_url}`; replaces the previous file | |
| Usage tracking | `GET /workspaces/{id}/usage?days=30` → counts per operation, `media_bytes`, `ai_generations` (always 0 in Phase 1) | Usage screen |
| Workspace-wide posts | `GET /workspaces/{id}/posts?status=&brand_id=&page=&limit=` | Dashboard, "needs approval" queue |
| Self-approval (D1) | `workspaces.allow_self_approval`: **true** for a new (one-person) workspace; switched **off automatically when the second member joins** (1 → 2 transition only, audited). Owner can change it any time via `PATCH /workspaces/{id}` `{allow_self_approval}`; a deliberate re-enable is not undone by later invites. Returned on `WorkspaceResponse`. When false, author ≠ approver is enforced. | Toggle on workspace settings, owner only; show the add-member response message, which explains the switch |
| Demo seed | `python -m seeds.seed` → Demo Agency: owner `demo@example.com` + admin `reviewer@example.com` (password `DemoPassword123!`), 2 brands, 2 mock accounts, 7 posts covering every state, 16 templates. Two members, so self-approval is off (reviewer approves). For the single-user journey, register a fresh account. Refuses to run in production. | |

Everything else in the research report's Wave 2/3 (WhatsApp alerts, compliance-lite, importers, white-label, AI provenance) stays out of Phase 1.

---

## 5. Four-week execution plan (adjusted: backend exists)

The owner's week plan assumed backend and frontend built together. With the backend done, Week 1 is lighter on foundation and heavier on API feasibility and design.

### Week 1 — API feasibility, design, frontend foundation
- **API feasibility gate (owner checkpoint):** create Meta developer app, Business-verified test Page + Instagram business account; run real Facebook photo publish and Instagram publish through our adapters against S3/R2 (local storage cannot serve Meta). Record which formats work (feed image, carousel is MVP-single-image). Decide LinkedIn path (D3).
- Backend: the §4 items.
- Frontend: project scaffold (stack per D2), auth flow (access token in memory, silent refresh, single-flight refresh lock, CSRF header), API client with typed responses from `/openapi.json`, app shell, brand switcher, design tokens.
- **Exit:** wireframes for the 11 screens agreed; FB/IG publish proven or fallback documented.

### Week 2 — Brand setup + Post Studio (manual content)
- Brands list/form with logo upload.
- Post Studio: template picker (industry/category/search), placeholder fill, caption/hashtags/CTA editor with per-platform char counters, media upload + reorder + preview (IG square/portrait, FB, LinkedIn text), per-platform override tab.
- Posts list per brand with status filter.
- **Exit (owner):** stakeholder can create, edit and save a draft.

### Week 3 — Approval, calendar, publishing
- Post detail: submit / approve / reject / withdraw with role-aware buttons; Approval Evidence panel (history, version, hash, who/when).
- Schedule modal with validation call and tz handling; publish-now; cancel schedule.
- Publish Jobs panel with live status (poll every 5 s while any job is non-terminal), error text, `needs_review` explanation.
- Connections page: list, connect Facebook (redirect flow + callback landing `/social-accounts?connected=N`), mock connect (non-prod), disconnect, token-expiry countdown + `needs_reauth` banner.
- Calendar month/list view.
- **Exit (owner):** approved content moves through a validated publishing path, visible end-to-end.

### Week 4 — Stabilise, deploy, review
- Hosted review environment (D4): API, worker, beat, Postgres, Redis, S3-compatible bucket, HTTPS, `ENVIRONMENT=staging`, `COOKIE_SECURE=true`.
- Seed demo workspace; usage summary screen; members list.
- Test pass: tenancy (second workspace cannot see first), approval integrity, failure scenarios (disconnected account, expired token, unsupported format), mobile layout of approval and connections screens.
- Deliverables: demo script, test summary, `docs/known_limitations.md`, prioritised Phase 2 backlog.
- **Exit (owner):** MVP review and sign-off against §3.

---

## 6. Decisions needed at the scope-confirmation gate

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Owner journey says the *same user* submits and approves. Backend enforces approver ≠ author. | Add workspace setting `allow_self_approval` (default **on** for single-user workspaces, off once a second member joins). Keeps the demo possible and the agency rule intact. |
| **D2** | Owner doc proposes Next.js + NestJS + BullMQ. Backend is FastAPI + Celery (already built, reviewed). Frontend not started. | Keep FastAPI/Celery (equivalent architecture: modular monolith + separate workers, as the doc requires). Frontend: **React + Vite + TypeScript** SPA — the app is fully behind login, no SEO/SSR need, and the in-memory-token auth design fits an SPA. Next.js is acceptable if the stakeholder insists; cost is +2–3 days for SSR/auth plumbing. Put this on the scope-gate agenda explicitly. |
| **D3** | LinkedIn: adapter exists (text posts), no OAuth connect flow. | Phase 1 ships LinkedIn as **mock-only** (documented limitation) unless the stakeholder's LinkedIn developer app is approved for the Community Management API in Week 1; then add the connect flow (~1.5 days). Note: LinkedIn Marketing API version 202511 sunsets 16 Nov 2026 — build on the current version. |
| **D4** | Hosting for the review environment. | Managed PaaS (Railway or Render: API + worker + beat services, managed Postgres + Redis) plus Cloudflare R2 for media (S3-compatible, free egress — Meta fetches media by URL). Owner's "managed hosting" line is satisfied; no Kubernetes. |
| **D5** | Instagram in MVP: single image only (carousel/Reels/Stories later). | Confirm; matches owner's "support limited to validated formats". |
| **D6** | Pricing/plans shown in UI? | No — Phase 3. Phase 1 UI has no plan or credit concepts beyond the usage summary. |

---

## 7. Known limitations to state up front (will become `known_limitations.md`)

- No AI generation in Phase 1; Smart Templates and manual editing stand in. `usage_logs.ai_generation` is reserved.
- Facebook: single image or text; Instagram: single image, business account linked to a Page, media must be on S3/R2; LinkedIn: text-only and mock unless D3 changes.
- Instagram API cap 100 posts / 24 h per account; Facebook native scheduling not used (we schedule ourselves).
- Meta tokens expire ~60 days; UI warns from 7 days out; reconnect = re-run Facebook connect.
- Posts are hard-deleted; brands and accounts are soft-deactivated.
- Member removal / role change, password reset, profile edit: not in Phase 1 (owner: "advanced organization administration excluded").
- Review environment is **not** production-ready (owner §6 / Phase 6 gate): no backups tested, no monitoring, no SLA.

---

## 8. Deviations from the owner document to raise transparently

1. **AI is deferred** (owner's request for this phase). The MVP journey step 2 becomes template-driven; the review should evaluate the *workflow*, not content quality.
2. **Backend stack differs** from the proposal (FastAPI/Celery vs NestJS/BullMQ). Architecture principles in the doc's §7 are all met: modular monolith, separate workers, persisted jobs, approval tied to a content version, encrypted credentials never returned, AI cannot bypass approval.
3. **Approval is stricter than the doc** (hash-bound, author ≠ approver, pending posts locked). This exceeds acceptance criterion 2 and is a planned differentiator (see `reports/Social media SaaS competitor features.md`, "Approval Evidence"); D1 keeps the single-user demo possible.
4. **Tenancy and reliability safeguards** requested for Phase 6 (tenant isolation, needs-review reconciliation, token expiry handling) are already in place; Phase 6 becomes verification rather than construction.
