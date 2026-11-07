# 7. Developer setup guide

Everything a new developer needs to get OmniPost running on their own laptop, from an empty machine to the full demo journey (write → approve → publish).

Tested on Windows 11 with PowerShell, Docker Desktop, Python 3.12.10, Node.js 20.18 and npm 11. macOS and Linux commands are shown where they differ.

**Time needed:** about 30 minutes the first time (mostly downloads), 1 minute on later days.

---

## Contents

1. [What you will run](#1-what-you-will-run)
2. [Install the tools](#2-install-the-tools)
3. [Get the code](#3-get-the-code)
4. [Set up the backend](#4-set-up-the-backend)
5. [Set up the web app](#5-set-up-the-web-app)
6. [Start everything](#6-start-everything)
7. [Sign in and try the demo journey](#7-sign-in-and-try-the-demo-journey)
8. [Daily routine](#8-daily-routine)
9. [Tests and checks](#9-tests-and-checks)
10. [Project layout](#10-project-layout)
11. [Settings reference (`backend/.env`)](#11-settings-reference-backendenv)
12. [Optional: real Facebook / Instagram and S3 storage](#12-optional-real-facebook--instagram-and-s3-storage)
13. [Problems and fixes](#13-problems-and-fixes)
14. [Short version](#14-short-version)

---

## 1. What you will run

| # | Part | What it does | Runs in | Address |
|---|---|---|---|---|
| 1 | **PostgreSQL 16** | The database | Docker | `localhost:5432` |
| 2 | **Redis 7** | Job queue, login rate limits, OAuth state | Docker | `localhost:6379` |
| 3 | **API** (FastAPI) | The backend the web app talks to | Terminal 1 | http://localhost:8000 |
| 4 | **Worker** (Celery) | Publishes posts in the background | Terminal 2 | — |
| 5 | **Scheduler** (Celery Beat) | Every minute, hands due posts to the worker | Terminal 3 | — |
| 6 | **Web app** (React + Vite) | The screens | Terminal 4 | http://localhost:5173 |

Parts 1, 2, 3 and 6 are enough to click through every screen. Without 4 and 5, posts are never actually published: they stay *Scheduled*.

---

## 2. Install the tools

| Tool | Version | Download |
|---|---|---|
| **Git** | any recent | https://git-scm.com/downloads |
| **Python** | **3.12** | https://www.python.org/downloads/ (Windows: tick *Add python.exe to PATH*) |
| **Node.js** | **20 LTS or newer** (npm comes with it) | https://nodejs.org/ |
| **Docker Desktop** | any recent | https://www.docker.com/products/docker-desktop/ |
| **VS Code** (recommended) | any | https://code.visualstudio.com/ |

Check in a terminal:

```bash
git --version
python --version        # macOS/Linux: python3 --version
node --version
npm --version
docker --version
```

You should see `Python 3.12.x`, `v20.x` or newer, and a Docker version. Then open **Docker Desktop** and wait until it says **Engine running**.

> On macOS/Linux, use `python3` wherever this guide says `python` if `python` isn't found.

---

## 3. Get the code

You need access to the private repository first (ask the project owner to add your GitHub account).

```bash
git clone https://github.com/Saurabh-Chaudhari-18/omnipost.git
cd omnipost
```

The repository has two apps side by side: `backend/` and `frontend/`. Each command below says which folder to run it in.

---

## 4. Set up the backend

All commands in this section run in the **`backend`** folder:

```bash
cd backend
```

### 4.1 Create a virtual environment (keeps project packages separate)

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Your prompt now starts with `(.venv)`. Activate it again in every new backend terminal.

> If PowerShell says *running scripts is disabled*, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then activate again.

### 4.2 Install the Python packages

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 4.3 Create your settings file

Windows:

```powershell
Copy-Item .env.example .env
```

macOS / Linux:

```bash
cp .env.example .env
```

Open `backend/.env` and replace the two `CHANGE_ME` values. Generate them with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The first output goes into `SECRET_KEY`, the second into `FERNET_KEY`. Leave everything else as it is for local development.

> ⚠️ `.env` holds secrets. Git ignores it. **Never commit it, never share it in chat.**
> Never change `FERNET_KEY` after social accounts are connected; their saved tokens become unreadable.

### 4.4 Start the database and Redis

```bash
docker compose up -d postgres redis
docker compose ps
```

Both must show `running` and `(healthy)`. If you see `(health: starting)`, wait a few seconds and run `docker compose ps` again.

### 4.5 Create the tables and the demo data

```bash
python -m alembic upgrade head
python -m seeds.seed
```

- `alembic upgrade head` creates every table (migrations `0001` → `0004`). Check with `python -m alembic current`: it ends with `(head)`.
- `seeds.seed` adds a demo agency, two demo users, two brands, two test social accounts (a Facebook Page and a LinkedIn page), posts in every state and the 16 Smart Templates. Add a test Instagram account any time from **Connected accounts → Add a test account**. It is safe to run again (no duplicates) and refuses to run in production.

---

## 5. Set up the web app

In a new terminal, in the **`frontend`** folder:

```bash
cd frontend
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json` (use `npm install` only when you are adding a package).

No settings file is needed: in development the web app sends every `/api` request through Vite to `http://localhost:8000`, so the browser sees a single address and the login cookies work.

---

## 6. Start everything

Use **four terminals**. In the three backend ones, activate the virtual environment first (step 4.1).

**Terminal 1: API** (in `backend`)

```bash
python -m uvicorn app.main:app --reload --port 8000
```

Check these in a browser:

| Open | You should see |
|---|---|
| http://localhost:8000/api/v1/health | `{"status":"ok"}` |
| http://localhost:8000/api/v1/ready | `"status":"ready"` with database and redis `ok` |
| http://localhost:8000/docs | The interactive API documentation |

**Terminal 2: Worker** (in `backend`)

Windows:

```powershell
python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo
```

macOS / Linux:

```bash
python -m celery -A app.workers.celery_app worker --loglevel=info
```

> `--pool=solo` is **required on Windows**; without it the worker starts but never runs jobs.

It ends with `celery@<your-computer> ready.`

**Terminal 3: Scheduler** (in `backend`)

```bash
python -m celery -A app.workers.celery_app beat --loglevel=info
```

Within a minute it prints `Sending due task dispatch-due-publish-jobs`.

**Terminal 4: Web app** (in `frontend`)

```bash
npm run dev
```

Open **http://localhost:5173**.

> The very first start after installing can show a blank page while Vite prepares files. Wait 5 seconds and reload.

---

## 7. Sign in and try the demo journey

### Demo accounts (from `backend/seeds/seed.py`, local development only)

| Email | Password | Role |
|---|---|---|
| `demo@example.com` | `DemoPassword123!` | Owner |
| `reviewer@example.com` | `DemoPassword123!` | Admin (can approve) |

New accounts start in **dark mode**; switch to Light or "Match my device" from the avatar menu at the bottom of the left rail. The choice is saved to your account.

### The journey to try (5 minutes)

1. Sign in as `demo@example.com`. **Home** shows counts, what needs attention, upcoming posts and account health.
2. Use the brand button (second tile in the left rail) to pick **Aura Coffee**, then **Posts → New post**.
3. Write a title and a caption, add hashtags (press Enter after each). Watch the Instagram / Facebook / LinkedIn preview and the limit rings update as you type. Tap a channel card to give that platform its own wording.
4. **Save draft**, then **Send for approval**. The post locks and gets its seal (fingerprint).
5. Approve it: the demo workspace has two members, so self-approval is **off** and the author can't approve their own post. Either sign out and sign in as `reviewer@example.com` to approve, or (as the owner) turn on self-approval in **Settings**. The seal stamps onto the approval record.
6. In **Where should it go?**, pick the accounts (if you added a test Instagram account, untick it when the post has no photo: Instagram needs one), then **Post right now**, or pick a time and **Schedule post**.
7. With the worker running, the post becomes **Published** within seconds and each account shows **Posted**. The demo accounts are test accounts: nothing reaches real Facebook, Instagram or LinkedIn.
8. Open **View approval certificate** in the approval record. **Print or save as PDF** prints only the certificate.

---

## 8. Daily routine

**Start:** open Docker Desktop, then

```bash
# backend folder
docker compose up -d postgres redis
python -m alembic upgrade head          # only needed after pulling new code
```

and start the four terminals from step 6.

**After `git pull`:** run `python -m pip install -r requirements.txt` (backend), `python -m alembic upgrade head` (backend) and `npm ci` (frontend) if those files changed.

**Stop:** press **Ctrl + C** in each terminal (4 → 1), then in `backend`:

```bash
docker compose stop
```

| Command (in `backend`) | Containers | Your data |
|---|---|---|
| `docker compose stop` | stopped, kept | **kept** (normal end of day) |
| `docker compose down` | removed | **kept** (in Docker volumes) |
| `docker compose down -v` | removed | ❌ **deleted** (start from zero, then redo step 4.5) |

---

## 9. Tests and checks

**Backend** (in `backend`, database running):

```bash
python -m pytest -m "not integration"     # 54 unit tests, no database needed
python -m pytest tests/integration        # 12 database tests: real API + worker on a throwaway *_test database
```

> On Windows, run the two groups separately as shown. Running both in one `pytest` command can hang at shutdown on Windows.

**Web app** (in `frontend`):

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Type check + production build into `dist/` |
| `npm run gen:api` | Regenerate `src/lib/api-schema.d.ts` from the running API after backend schema changes (API must be running) |

GitHub Actions runs the backend tests and a Docker image build on every push and pull request.

---

## 10. Project layout

```
omnipost/
├── backend/
│   ├── app/
│   │   ├── api/v1/          HTTP endpoints, one module per area (auth, posts, media, …)
│   │   ├── core/            security, access control, middleware, rate limiting
│   │   ├── db/              database sessions (async for the API, sync for workers)
│   │   ├── models/          database tables
│   │   ├── schemas/         request / response models
│   │   ├── services/        platform adapters, Meta OAuth, storage, encryption, audit
│   │   └── workers/         Celery tasks: publishing, token checks, cleanup
│   ├── alembic/versions/    database migrations 0001–0004
│   ├── seeds/               demo data + Smart Templates
│   ├── tests/               unit + database integration tests
│   ├── docker-compose.yml   PostgreSQL, Redis, MinIO for local development
│   └── .env.example         settings template
├── frontend/
│   ├── src/
│   │   ├── app/AppShell.tsx icon rail (desktop) and bottom bar (phone)
│   │   ├── pages/           one folder or file per screen; posts/ holds Post Studio
│   │   ├── components/      shared parts; ui/ = shadcn/ui components
│   │   ├── lib/             API client, auth, theme, workspace, query hooks
│   │   └── index.css        all colours and fonts (design tokens)
│   └── vite.config.ts       dev server + /api proxy
└── docs/                    project documentation (this file is 07)
```

Where to read next: [05_backend_technical_guide.md](05_backend_technical_guide.md) for how the backend works, [06_system_design.md](06_system_design.md) for the overall design, `frontend/README.md` for the web app.

---

## 11. Settings reference (`backend/.env`)

| Setting | Local value | What it is |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` turns on strict checks: real secrets, secure cookies, no API docs, no test accounts or demo data |
| `DEBUG` | `true` | More logging |
| `COOKIE_SECURE` | `false` | `true` when served over HTTPS |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/ai_content` | Matches the Docker database |
| `REDIS_URL` | `redis://localhost:6379/0` | Matches the Docker Redis |
| `SECRET_KEY` | generated (step 4.3) | Signs login tokens |
| `FERNET_KEY` | generated (step 4.3) | Encrypts saved social media tokens |
| `ALLOWED_ORIGINS` | `["http://localhost:5173", …]` | Sites allowed to call the API |
| `FRONTEND_URL` | `http://localhost:5173` | Where Facebook login sends the user back |
| `META_APP_ID`, `META_APP_SECRET` | empty | Only for real Facebook / Instagram (section 12) |
| `STORAGE_BACKEND` | `local` | `s3` for real photo publishing (section 12) |
| `MAX_IMAGE_SIZE_MB`, `MAX_VIDEO_SIZE_MB`, `MAX_MEDIA_PER_POST` | 25, 100, 10 | Upload limits |

The API **refuses to start** if a required value is missing or invalid, and the error message names the setting.

---

## 12. Optional: real Facebook / Instagram and S3 storage

Not needed for development or demos: the seeded test accounts simulate publishing end to end.

- **Connect real Facebook / Instagram:** create a Meta developer app (type *Business*), add *Facebook Login for Business*, set the redirect URL to `http://localhost:8000/api/v1/social/callback/facebook`, and put the app ID and secret into `META_APP_ID` / `META_APP_SECRET`. In development mode only people with a role on the Meta app can connect their Pages. See the licences notes in [04_progress_and_roadmap.md](04_progress_and_roadmap.md).
- **Real photo publishing needs S3-compatible storage,** because Meta downloads images by URL. Locally: `docker compose up -d minio`, create the bucket `ai-content-media` in the MinIO console at http://localhost:9001 (user and password `minioadmin`), then set `STORAGE_BACKEND=s3` in `.env` and restart the API and worker. In staging and production use Cloudflare R2 or AWS S3.

---

## 13. Problems and fixes

| You see | Why | Fix |
|---|---|---|
| `error during connect … docker` | Docker Desktop isn't running | Start Docker Desktop, wait for *Engine running* |
| `/api/v1/ready` says `"degraded"` | Database or Redis stopped | `docker compose up -d postgres redis` |
| API stops at start with a `SECRET_KEY`, `FERNET_KEY` or `DATABASE_URL` error | `.env` missing or incomplete | Redo step 4.3 |
| `relation "…" does not exist` | Tables missing or out of date | `python -m alembic upgrade head` |
| `ModuleNotFoundError` in a backend terminal | Virtual environment not active | Activate it (step 4.1) |
| `'uvicorn' / 'celery' is not recognized` | Scripts folder not on PATH | Always start them with `python -m …` as written |
| Port 8000 or 5173 already in use | Another copy is running | Windows: `netstat -ano \| findstr :8000`, then `taskkill /PID <number> /F`. macOS/Linux: `lsof -i :8000`, then `kill <pid>` |
| Posts stay *Scheduled* forever | Worker or scheduler not running, or `--pool=solo` missing on Windows | Start terminals 2 and 3 exactly as in step 6 |
| Instagram shows *Needs a fix* | Instagram requires at least one photo | Add a photo, or untick Instagram |
| Can't approve your own post | Self-approval is off (team workspace) | Approve as another admin, or turn it on in Settings (owner only) |
| Blank page on the first start | Vite still preparing files | Wait 5 seconds, reload |
| Browser console shows `POST /api/v1/auth/refresh 403` on the sign-in page | Normal before you sign in | Nothing to fix |
| `npm ci` fails or the web app won't start | Node older than 20 | Install Node 20 LTS or newer |
| PowerShell won't activate `.venv` | Script execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, once |

**Look inside the database** (in `backend`):

```bash
docker compose exec postgres psql -U postgres -d ai_content
```

Then e.g. `\dt` (tables), `SELECT email FROM users;`, `SELECT title, status FROM posts;`, and `\q` to leave.

---

## 14. Short version

Once everything is installed:

```bash
# backend (venv active)
docker compose up -d postgres redis
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000                              # Terminal 1
python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo    # Terminal 2 (drop --pool=solo on macOS/Linux)
python -m celery -A app.workers.celery_app beat --loglevel=info                  # Terminal 3

# frontend
npm run dev                                                                      # Terminal 4
```

Open http://localhost:5173 and sign in with `demo@example.com` / `DemoPassword123!`.
