"""Shared setup for the browser-test helpers (start_api.py, read_email.py).

Points the app at its own database, `ai_content_e2e`, before anything from
`app` is imported (the app reads its settings once, on first import), so test
accounts never mix with the demo data. Everything else (SECRET_KEY,
FERNET_KEY, REDIS_URL) comes from the environment or backend/.env.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
DB_NAME = os.environ.get("E2E_DB_NAME", "ai_content_e2e")

# Test-only staff login, created in the e2e database only (start_api.py).
STAFF_EMAIL = os.environ.get("E2E_STAFF_EMAIL", "e2e-staff@example.com")
STAFF_PASSWORD = os.environ.get("E2E_STAFF_PASSWORD", "e2e-staff-password-1")


def _dotenv(key: str) -> str | None:
    env_file = BACKEND / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def configure(create_database: bool = False):
    """Set the environment for the e2e database; return its sync URL."""
    os.chdir(BACKEND)
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))

    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    base = os.environ.get("E2E_BASE_DATABASE_URL") or os.environ.get("DATABASE_URL") or _dotenv("DATABASE_URL")
    if not base:
        sys.exit("DATABASE_URL is not set (environment or backend/.env).")
    # Remember the server-level URL, so a second call (or a child process)
    # doesn't mistake the e2e database for the base one.
    os.environ["E2E_BASE_DATABASE_URL"] = base
    target = make_url(base).set(database=DB_NAME)
    sync_target = target.set(drivername="postgresql+psycopg2")

    if create_database:
        admin = create_engine(sync_target.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            if not conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": DB_NAME}).scalar():
                conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))
        admin.dispose()

    os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
    os.environ["SYNC_DATABASE_URL"] = sync_target.render_as_string(hide_password=False)
    # Test-friendly settings. Never production: the mock "connect account"
    # route and the console email backend are refused there.
    os.environ["ENVIRONMENT"] = "development"
    os.environ["DEBUG"] = "false"
    os.environ["EMAIL_BACKEND"] = "console"
    os.environ["RATE_LIMIT_AUTH_ATTEMPTS"] = "100000"
    os.environ["RATE_LIMIT_WORKSPACE_PER_MINUTE"] = "100000"
    return sync_target
