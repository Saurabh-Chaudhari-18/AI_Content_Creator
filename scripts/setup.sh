#!/usr/bin/env bash
# OmniPost — one-time setup on macOS / Linux (also works in Git Bash on Windows).
# Safe to run again.
#
#   From the repository root:   bash scripts/setup.sh
#
# Checks the tools, creates backend/.env with new secret keys (if missing), creates the
# Python virtual environment and installs packages, starts PostgreSQL and Redis in Docker,
# creates the tables, adds demo data, and installs the web app packages.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mSetup stopped: %s\033[0m\n' "$1"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' was not found. $2"; }

# Secret keys without needing Python: URL-safe base64 of random bytes
new_secret() { openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'; }
new_fernet() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'; }   # 44 chars incl. "=" padding

step "Checking the tools"
need git "Install Git: https://git-scm.com/downloads"
need node "Install Node.js 20 LTS or newer: https://nodejs.org/"
need npm "It comes with Node.js: https://nodejs.org/"
need docker "Install Docker Desktop (or Docker Engine): https://docs.docker.com/get-docker/"
need openssl "Install OpenSSL (macOS and most Linux systems already have it)."
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || fail "Python 3.12 was not found. Install it from https://www.python.org/downloads/"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' \
  || fail "Python $("$PY" --version 2>&1) found; 3.12 or newer is needed."
NODE_MAJOR="$(node --version | sed 's/^v//; s/\..*//')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $(node --version) found; 20 or newer is needed."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker, then run this again."
ok "$("$PY" --version), Node $(node --version), Docker running"

step "Settings file (backend/.env)"
if [ -f "$BACKEND/.env" ]; then
  ok "backend/.env already exists - kept as it is"
else
  sed -e "s|^SECRET_KEY=CHANGE_ME.*|SECRET_KEY=$(new_secret)|" \
      -e "s|^FERNET_KEY=CHANGE_ME.*|FERNET_KEY=$(new_fernet)|" \
      "$BACKEND/.env.example" > "$BACKEND/.env"
  ok "Created backend/.env with new SECRET_KEY and FERNET_KEY (never commit or share it)"
fi

step "Python virtual environment and packages"
cd "$BACKEND"
[ -d .venv ] || "$PY" -m venv .venv
if [ -x .venv/bin/python ]; then VPY="$BACKEND/.venv/bin/python"; else VPY="$BACKEND/.venv/Scripts/python.exe"; fi
"$VPY" -m pip install --quiet --upgrade pip
"$VPY" -m pip install --quiet -r requirements.txt
ok "Backend packages installed in backend/.venv"

step "Database and Redis (Docker)"
docker compose up -d postgres redis
for _ in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 \
  || fail "PostgreSQL did not become ready. Check 'docker compose ps' in the backend folder."
ok "PostgreSQL and Redis are running"

step "Tables and demo data"
"$VPY" -m alembic upgrade head
"$VPY" -m seeds.seed
ok "Database is up to date and has demo data"

step "Web app packages"
cd "$FRONTEND"
npm ci --no-audit --no-fund
ok "Web app packages installed"

printf '\n\033[32mSetup complete.\033[0m\n'
echo "Start everything with:  bash scripts/start.sh"
echo "Then open http://localhost:5173 and sign in with demo@example.com / DemoPassword123!"
