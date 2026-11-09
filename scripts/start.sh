#!/usr/bin/env bash
# OmniPost — start everything on macOS / Linux (after scripts/setup.sh has run once).
#
#   From the repository root:   bash scripts/start.sh
#
# Starts PostgreSQL and Redis, applies any new database changes, runs the API, worker and
# scheduler in the background (logs in .logs/), and the web app in this terminal.
# Press Ctrl+C to stop all of them. Stop the database later with: docker compose stop (in backend).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="$ROOT/.logs"

if [ -x "$BACKEND/.venv/bin/python" ]; then VPY="$BACKEND/.venv/bin/python"; else VPY="$BACKEND/.venv/Scripts/python.exe"; fi
if [ ! -e "$VPY" ] || [ ! -d "$FRONTEND/node_modules" ]; then
  echo "Run the one-time setup first:  bash scripts/setup.sh"; exit 1
fi
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker first."; exit 1; }

# Celery needs the "solo" pool on Windows (Git Bash)
POOL=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) POOL="--pool=solo" ;; esac

cd "$BACKEND"
docker compose up -d postgres redis
for _ in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
"$VPY" -m alembic upgrade head

mkdir -p "$LOGS"
PIDS=()
cleanup() {
  echo; echo "Stopping API, worker and scheduler..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

"$VPY" -m uvicorn app.main:app --reload --port 8000 >"$LOGS/api.log" 2>&1 & PIDS+=($!)
"$VPY" -m celery -A app.workers.celery_app worker --loglevel=info $POOL >"$LOGS/worker.log" 2>&1 & PIDS+=($!)
"$VPY" -m celery -A app.workers.celery_app beat --loglevel=info >"$LOGS/beat.log" 2>&1 & PIDS+=($!)

echo "API, worker and scheduler started (logs: .logs/api.log, .logs/worker.log, .logs/beat.log)"
echo "Web app: http://localhost:5173  ·  sign in with demo@example.com / DemoPassword123!"
echo "Press Ctrl+C to stop everything."
cd "$FRONTEND"
npm run dev
