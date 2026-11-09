#!/usr/bin/env bash
# OmniPost — run the WHOLE project in Docker on macOS / Linux. Only Docker is needed
# (no Python or Node).
#
#   From the repository root:   bash scripts/docker-up.sh
#
# Creates backend/.env with new secret keys (if missing), then builds and starts the
# database, Redis, API, worker, scheduler and web app. Demo data is added automatically.
#   Web app: http://localhost:4173   (another port: WEB_PORT=4174 bash scripts/docker-up.sh)
#   Stop:    docker compose -f backend/docker-compose.yml --profile full down   (data is kept)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"

command -v docker >/dev/null 2>&1 || { echo "Docker was not found: https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker first."; exit 1; }

if [ ! -f "$BACKEND/.env" ]; then
  command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is needed to create the secret keys."; exit 1; }
  SECRET="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
  FERNET="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n')"
  sed -e "s|^SECRET_KEY=CHANGE_ME.*|SECRET_KEY=$SECRET|" \
      -e "s|^FERNET_KEY=CHANGE_ME.*|FERNET_KEY=$FERNET|" \
      "$BACKEND/.env.example" > "$BACKEND/.env"
  echo "Created backend/.env with new secret keys (never commit or share it)."
fi

echo "Building and starting (the first time takes a few minutes)..."
docker compose -f "$BACKEND/docker-compose.yml" --profile full up -d --build

PORT="${WEB_PORT:-4173}"
READY=no
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/ready" 2>/dev/null | grep -q '"ready"'; then READY=yes; break; fi
  sleep 2
done
if [ "$READY" != yes ]; then
  echo
  echo "The containers started, but the app did not answer on port $PORT within 3 minutes."
  echo "Check the logs:  docker compose -f backend/docker-compose.yml --profile full logs --tail 50"
  echo "If another program uses port $PORT, run:  WEB_PORT=4174 bash scripts/docker-up.sh"
  exit 1
fi

echo
echo "OmniPost is running: http://localhost:$PORT"
echo "Sign in with demo@example.com / DemoPassword123!"
echo "Logs:  docker compose -f backend/docker-compose.yml --profile full logs -f"
echo "Stop:  docker compose -f backend/docker-compose.yml --profile full down"
