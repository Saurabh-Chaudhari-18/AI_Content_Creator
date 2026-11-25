"""Start the API for the browser tests (Playwright `webServer`).

Run with the backend's Python (any working folder):
    backend/.venv/Scripts/python frontend/e2e/start_api.py   (Windows)
    python frontend/e2e/start_api.py                         (CI)

It uses its OWN database, `ai_content_e2e` (created if missing, migrated to
head), so test accounts never mix with the demo data, and its own port (8010)
so it never collides with a developer's API on 8000. Everything else
(SECRET_KEY, FERNET_KEY, REDIS_URL) comes from the environment or backend/.env.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

PORT = int(os.environ.get("E2E_API_PORT", "8010"))
DB_NAME = os.environ.get("E2E_DB_NAME", "ai_content_e2e")


def _dotenv(key: str) -> str | None:
    env_file = BACKEND / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


# The app reads its settings once, on first import, so everything is decided
# here, before anything from `app` is imported.
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

base = os.environ.get("DATABASE_URL") or _dotenv("DATABASE_URL")
if not base:
    sys.exit("DATABASE_URL is not set (environment or backend/.env).")
target = make_url(base).set(database=DB_NAME)
sync_target = target.set(drivername="postgresql+psycopg2")

admin = create_engine(sync_target.set(database="postgres"), isolation_level="AUTOCOMMIT")
with admin.connect() as conn:
    if not conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": DB_NAME}).scalar():
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))
admin.dispose()

os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
os.environ["SYNC_DATABASE_URL"] = sync_target.render_as_string(hide_password=False)
# Test-friendly settings. Never production: the mock "connect account" route
# and the console email backend are refused there.
os.environ["ENVIRONMENT"] = "development"
os.environ["DEBUG"] = "false"
os.environ["EMAIL_BACKEND"] = "console"
os.environ["RATE_LIMIT_AUTH_ATTEMPTS"] = "100000"
os.environ["RATE_LIMIT_WORKSPACE_PER_MINUTE"] = "100000"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

cfg = Config(str(BACKEND / "alembic.ini"))
cfg.set_main_option("script_location", str(BACKEND / "alembic"))
command.upgrade(cfg, "head")

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
