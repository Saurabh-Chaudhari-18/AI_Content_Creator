# How to run the project on your computer

Every command here was tested on this machine (Windows 11, PowerShell, Docker Desktop, Python 3.12, Node 20).

## What runs, and why

| # | Part | What it does | Where it runs | Address |
|---|---|---|---|---|
| 1 | **PostgreSQL** | The database (all users, brands, posts…) | Docker | `localhost:5432` |
| 2 | **Redis** | Message queue for background jobs + login rate limits | Docker | `localhost:6379` |
| 3 | **API** (FastAPI) | The backend the website talks to | Terminal 1 | http://localhost:8000 |
| 4 | **Worker** (Celery) | Actually publishes posts in the background | Terminal 2 | — |
| 5 | **Scheduler** (Celery Beat) | Every minute, finds posts that are due and hands them to the worker | Terminal 3 | — |
| 6 | **Web app** (React) | The screens you use | Terminal 4 | http://localhost:5173 |

You can **use the website with only 1, 2, 3 and 6**. Without 4 and 5, everything works except posts are never actually published (they stay "Scheduled").

> **"Where to run"** in this guide means which folder your terminal must be in.
> Open a terminal (PowerShell) in VS Code or Windows Terminal, then `cd` into that folder first.
>
> ```powershell
> cd "F:\AI Content Creator\backend"     # for backend commands
> cd "F:\AI Content Creator\frontend"    # for frontend commands
> ```

---

## A. First-time setup (do once)

Skip this section if the project already runs on your computer.

### A1. Install the tools

- **Docker Desktop** — https://www.docker.com/products/docker-desktop/
- **Python 3.12**
- **Node.js 20** or newer

Check (any folder):

```powershell
docker --version
python --version
node --version
```

You should see versions such as `Docker version 29…`, `Python 3.12…`, `v20…`.

### A2. Backend settings file (`.env`)

**Where:** `backend`

```powershell
Copy-Item .env.example .env
```

Open `backend\.env` and replace the two `CHANGE_ME` values. Generate them with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The first output is `SECRET_KEY`, the second is `FERNET_KEY`.

> ⚠️ Never commit `.env` (git already ignores it). Never change `FERNET_KEY` after social accounts are connected — the saved tokens can no longer be read.

### A3. Install backend packages

**Where:** `backend`

```powershell
python -m pip install -r requirements.txt
```

### A4. Start the database and create the tables

**Where:** `backend`

```powershell
docker compose up -d postgres redis
python -m alembic upgrade head
python -m seeds.seed
```

- `alembic upgrade head` creates/updates all tables.
- `seeds.seed` adds demo data and Smart Templates. Safe to run again — it never duplicates.

### A5. Install frontend packages

**Where:** `frontend`

```powershell
npm install
```

---

## B. Start everything (every day)

### B1. Start Docker Desktop

Open the Docker Desktop app and wait until it says **Engine running**.

### B2. Start the database and Redis

**Where:** `backend`

```powershell
docker compose up -d postgres redis
```

✅ **Check:**

```powershell
docker compose ps
```

Both lines must show `running` and `(healthy)`:

```
SERVICE    STATE     STATUS
postgres   running   Up 10 seconds (healthy)
redis      running   Up 10 seconds (healthy)
```

`(health: starting)` means wait a few seconds and run it again.

### B3. Update the database (only after pulling new code)

**Where:** `backend`

```powershell
python -m alembic upgrade head
```

✅ **Check:** `python -m alembic current` ends with `(head)`.

### B4. Terminal 1 — API

**Where:** `backend`

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

Leave this terminal open. `--reload` restarts the API automatically when you change backend code.

✅ **Check:** you should see `Uvicorn running on http://127.0.0.1:8000`. Then open in your browser:

| Open this | You should see |
|---|---|
| http://localhost:8000/api/v1/health | `{"status":"ok"}` |
| http://localhost:8000/api/v1/ready | `{"status":"ready","components":{"database":"ok","redis":"ok"}}` |
| http://localhost:8000/docs | The interactive API documentation |

If `/ready` says **`"degraded"`** with `"unreachable"`, the database or Redis is not running → go back to B2.

### B5. Terminal 2 — Worker (publishes posts)

**Where:** `backend`

```powershell
python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo
```

> `--pool=solo` is **required on Windows**. Without it the worker starts but does not run jobs.

✅ **Check:** the output lists 4 tasks and ends with:

```
Connected to redis://localhost:6379/0
celery@<your-pc-name> ready.
```

### B6. Terminal 3 — Scheduler (sends due posts every minute)

**Where:** `backend`

```powershell
python -m celery -A app.workers.celery_app beat --loglevel=info
```

✅ **Check:** you see `beat: Starting...`. Within about a minute:

- this terminal prints `Scheduler: Sending due task dispatch-due-publish-jobs`
- the **worker** terminal prints `Task …dispatch_due_jobs… succeeded … {'dispatched': 0}`

(`0` just means no post was due at that moment.)

### B7. Terminal 4 — Web app

**Where:** `frontend`

```powershell
npm run dev
```

✅ **Check:**

1. You see `VITE v6… ready` and `Local: http://localhost:5173/`.
2. Open http://localhost:5173 → the **Sign in** page appears.
3. Sign in with the demo account:
   - Email: `demo@example.com`
   - Password: `DemoPassword123!`
4. **Home** shows: 1 waiting for approval · 1 scheduled · 1 didn’t publish.
5. Reload the page — you should **stay signed in**.

> The very first start after `npm install` can show a **blank page** while Vite prepares files. Wait 5 seconds and reload.

---

## C. Quick health checklist

Run these any time something looks wrong.

| Question | Command or link | Good answer |
|---|---|---|
| Is Docker running? | `docker --version` and the Docker Desktop app | App says *Engine running* |
| Are DB and Redis up? | `docker compose ps` (in `backend`) | both `running (healthy)` |
| Can the API reach them? | http://localhost:8000/api/v1/ready | `"status":"ready"` |
| Is the API up? | http://localhost:8000/api/v1/health | `{"status":"ok"}` |
| Does the web app reach the API? | http://localhost:5173/api/v1/health | `{"status":"ok"}` (goes through the web app’s proxy) |
| Is the worker alive? | look at Terminal 2 | `ready.` and no red `ERROR` lines |
| Is the scheduler alive? | look at Terminal 3 | a `Sending due task` line every minute |
| Is the data there? | see D3 below | the expected tables / rows |

---

## D. Look inside the database

**Where:** `backend`

### D1. Open a SQL shell

```powershell
docker compose exec postgres psql -U postgres -d ai_content
```

Inside it:

| Type this | What it shows |
|---|---|
| `\dt` | All tables (14, including `alembic_version`) |
| `SELECT email, full_name FROM users;` | Users |
| `SELECT title, status FROM posts ORDER BY created_at;` | Posts and their status |
| `SELECT status, count(*) FROM publish_jobs GROUP BY status;` | Publishing jobs |
| `\q` | Leave the SQL shell |

### D2. Check Redis

```powershell
docker compose exec redis redis-cli ping
```

Answer: `PONG`.

### D3. One-line checks (no shell)

```powershell
docker compose exec -T postgres psql -U postgres -d ai_content -c "\dt"
docker compose exec -T postgres psql -U postgres -d ai_content -c "SELECT count(*) FROM users;"
```

---

## E. Stop everything

### E1. Stop the programs

In **each terminal** (4 → 3 → 2 → 1), press **Ctrl + C**.
If a terminal asks `Terminate batch job (Y/N)?`, type `Y` and Enter.

### E2. Stop the database and Redis

**Where:** `backend`

```powershell
docker compose stop
```

✅ **Check:** `docker compose ps` shows nothing (or `exited`). **Your data is kept** — next time just run B2 again.

### What the three "stop" commands do

| Command (in `backend`) | Containers | Your data | When to use |
|---|---|---|---|
| `docker compose stop` | stopped, kept | **kept** | ✅ Normal end of day |
| `docker compose down` | removed | **kept** (stored in Docker volumes) | Clean restart of the containers |
| `docker compose down -v` | removed | ❌ **DELETED — all users, posts, everything** | Only to start from zero on purpose. Then run A4 again. |

> Tested: after `docker compose stop` and `docker compose up -d postgres redis`, all data was still there and the worker and scheduler reconnected by themselves.

---

## F. Other useful commands

| What | Where | Command |
|---|---|---|
| Run backend tests | `backend` | `python -m pytest` |
| Build the web app (checks for errors) | `frontend` | `npm run build` |
| Type-check the web app only | `frontend` | `npm run typecheck` |
| Lint the web app | `frontend` | `npm run lint` |
| Refresh frontend API types after backend changes (API must be running) | `frontend` | `npm run gen:api` |
| Re-add demo data (safe, no duplicates) | `backend` | `python -m seeds.seed` |
| Database logs | `backend` | `docker compose logs -f postgres` (Ctrl + C to leave) |
| Which migration is applied | `backend` | `python -m alembic current` |

**Demo accounts** (from `seeds/seed.py`, development only):

| Email | Password | Role |
|---|---|---|
| `demo@example.com` | `DemoPassword123!` | Owner |
| `reviewer@example.com` | `DemoPassword123!` | Admin (can approve) |

---

## G. Problems and fixes

| You see | Why | Fix |
|---|---|---|
| `error during connect … docker_engine` | Docker Desktop is not running | Start Docker Desktop, wait for *Engine running* |
| `/ready` says `"degraded"` | DB or Redis stopped | B2 (`docker compose up -d postgres redis`) |
| `[Errno 10048] … address already in use` / port in use | Something already runs on 8000 or 5173 (maybe a second copy) | Find it: `netstat -ano \| findstr :8000` → last number is the process ID → `taskkill /PID <number> /F` |
| `Port 5173 is in use` | Same as above for the web app | Same fix with `:5173` |
| API stops at startup with `SECRET_KEY` / `FERNET_KEY` / `DATABASE_URL` error | `.env` missing or wrong | Redo A2 |
| `relation "…" does not exist` | Tables not created / not updated | `python -m alembic upgrade head` |
| Worker starts but posts never publish | Missing `--pool=solo`, or scheduler not running | Use the exact B5 command; start B6 |
| Blank web page the first time | Vite still preparing files | Wait 5 s, reload |
| Browser console shows `POST /api/v1/auth/refresh 403` on the sign-in page | Normal: you are not signed in yet | Nothing to fix |
| `npm run dev` says Node version too old | Node below 20 | Install Node 20+ |
| `'uvicorn' is not recognized` / `'celery' is not recognized` | Python’s Scripts folder isn’t on PATH | Always start them with `python -m …` as written above |

---

## H. Short version (once everything is installed)

```powershell
# backend folder
docker compose up -d postgres redis
python -m uvicorn app.main:app --reload --port 8000                                  # Terminal 1
python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo        # Terminal 2
python -m celery -A app.workers.celery_app beat --loglevel=info                      # Terminal 3

# frontend folder
npm run dev                                                                          # Terminal 4
```

Open http://localhost:5173 and sign in with `demo@example.com` / `DemoPassword123!`.

**Stop:** Ctrl + C in each terminal, then `docker compose stop` in `backend`.
