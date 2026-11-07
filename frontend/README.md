# OmniPost — web app

React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + shadcn/ui.
Data: TanStack Query. Routing: React Router 7.

## Run it

Needs the backend on `http://localhost:8000` (see `backend/README.md`) and Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Demo login (after `python -m seeds.seed` in `backend/`): `demo@example.com` / `DemoPassword123!`.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server. `/api` and `/static` are proxied to the backend |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm run gen:api` | Regenerate `src/lib/api-schema.d.ts` from the running backend's OpenAPI |

## How it fits together

- **One origin.** The browser always talks to `/api/...` on the app's own origin. In dev, Vite proxies it to the backend (`vite.config.ts`). In production the SPA and API must be served under the same site (reverse proxy), otherwise the refresh and CSRF cookies won't work.
- **Auth** (`src/lib/api.ts`, `src/lib/auth.tsx`):
  - access token in **memory only**;
  - refresh token in an HttpOnly cookie the JS never sees;
  - `X-CSRF-Token` header from the `csrf_token` cookie on `/auth/refresh` and `/auth/logout`;
  - refresh is **single-flight** (the backend rotates refresh tokens, so two parallel refreshes would log the user out);
  - on page load the app silently refreshes; if that fails, it shows the login page.
- **Types** come from the backend: `src/lib/api-schema.d.ts` is generated, never hand-edited. Re-run `npm run gen:api` after backend schema changes.
- **Workspace / brand selection** lives in `src/lib/workspace.tsx`; every page reads it with `useWorkspace()`.

## Design

The look is the product owner's design (reference mock: `docs/design/post-studio.html` in the project repo): obsidian surfaces, one indigo accent, amber for "waiting", emerald for "good", Plus Jakarta Sans + JetBrains Mono (Instrument Serif only on the approval certificate). The chrome stays quiet; colour lives in a few moments: the photo glow behind the live preview, the approval seal, the platforms' own tiles, and each brand's colour on its tiles.

All colours are tokens in `src/index.css` (`:root` = light, `.dark` = dark); components use token classes (`bg-card`, `text-muted-foreground`, `bg-surface-subtle`, `bg-warning-soft`, …), never raw hex. To restyle the app, change the tokens, not the components.

- **Dark is the default** for new accounts; Light and "Match my device" are in the avatar menu, saved to the account. `index.html` applies the saved theme before the first paint, so reloads never flash.
- `src/app/AppShell.tsx` — icon rail on desktop (workspace mark, brand switcher, sections with tooltips, settings, account), compact top bar + bottom bar on phones.
- `src/lib/brandColor.ts` — a brand's colour (its palette's first colour, or a stable colour from its id) for brand-owned elements only.
- `src/pages/posts/Seal.tsx` — the approval seal and the printable approval certificate.
- `src/components/ui/` — shadcn/ui components (owned by us, edit freely).

Rules we follow: one primary action per screen; colour only where it means something; no glows, gradient text or emoji icons; every field has a visible label; motion only where it explains something (and none for users who turn on reduced motion).

## Screens (Phase 1)

| Route | Screen | What it does |
|---|---|---|
| `/login`, `/register` | Sign in / Register | Session in memory, silent refresh on reload |
| `/` | Home | Live counts, “Needs your attention” (failures first), account health |
| `/posts` | Posts | All posts, status tabs, brand filter, paging, “New post” (asks which brand) |
| `/posts/new?brand=…[&template=…]`, `/posts/:id` | Post Studio | Live Instagram / Facebook / LinkedIn previews with per-platform limit rings; write; Smart Templates with fill-in blanks; per-platform text; hashtags; photos (upload, reorder, remove); send / approve / request changes / withdraw; pre-publish check per account; schedule or post now; live job status; **Try again** for failed posts (unknown outcomes need a “I checked” confirmation); approval record with the seal; printable approval certificate |
| `/calendar` | Calendar | Month grid of scheduled / published / failed posts; posts not yet scheduled |
| `/templates` | Smart Templates | Filter by industry, type, search; “Use this template” opens Post Studio |
| `/accounts` (`/social-accounts`) | Accounts | Health and expiry per account, connect Facebook (needs Meta app), add test account (dev), disconnect, recent failures |
| `/brands` | Brands | Add / edit (name, industry, audience, tone, language, logo), remove |
| `/settings` | Settings | Workspace name, self-approval rule (owner), team list + add member, 30-day usage |

Buttons follow the user’s role (owner / admin / member) and the workspace’s self-approval rule; the API is still the final authority.

### Known gaps (backend endpoints not built yet)

- Remove a member / change a role; password reset; profile edit.
- Approval certificate PDF download.
- Alt text can only be set at upload time (no edit endpoint).
