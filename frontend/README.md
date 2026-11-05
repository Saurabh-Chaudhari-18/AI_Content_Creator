# AI Content Creator — web app

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

The look is the "Chosen direction" on the design canvas: bento tiles, calm colours, plain words. All colours are tokens in `src/index.css` (`:root` = light, `.dark` = dark); components use token classes (`bg-card`, `text-muted-foreground`, `bg-warning-soft`, …), never raw hex. To restyle the app, change the tokens, not the components.

- `src/components/ui/` — shadcn/ui components (owned by us, edit freely).
- `src/components/Tile.tsx` — `BentoGrid` + `Tile` (tones: default / info / success / warning / danger).
- Light is the default; users can pick Dark or "Match my device" in the account menu.

Rules we follow (from the Impeccable review): one primary action per screen; a row or tile that needs action looks different from the rest; zero counts don't use alarm colours; every field has a visible label; no emoji as icons.

## Screens (Phase 1)

| Route | Screen | What it does |
|---|---|---|
| `/login`, `/register` | Sign in / Register | Session in memory, silent refresh on reload |
| `/` | Home | Live counts, “Needs your attention” (failures first), account health |
| `/posts` | Posts | All posts, status tabs, brand filter, paging, “New post” (asks which brand) |
| `/posts/new?brand=…[&template=…]`, `/posts/:id` | Post Studio | Write; Smart Templates with fill-in blanks; per-platform text; hashtags; photos (upload, reorder, remove); send / approve / request changes / withdraw; pre-publish check per account; schedule or post now; live job status; **Try again** for failed posts (unknown outcomes need a “I checked” confirmation); approval evidence and history |
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
