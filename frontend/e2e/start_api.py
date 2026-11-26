"""Start the API for the browser tests (Playwright `webServer`).

Run with the backend's Python (any working folder):
    backend/.venv/Scripts/python frontend/e2e/start_api.py   (Windows)
    python frontend/e2e/start_api.py                         (CI)

Uses its own database, `ai_content_e2e` (created if missing, migrated to
head), and its own port (8010), so it never touches the demo data or a
developer's API on 8000. Also makes sure the test-only staff login exists.
"""
import os

import e2e_env

PORT = int(os.environ.get("E2E_API_PORT", "8010"))
sync_url = e2e_env.configure(create_database=True)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

cfg = Config(str(e2e_env.BACKEND / "alembic.ini"))
cfg.set_main_option("script_location", str(e2e_env.BACKEND / "alembic"))
command.upgrade(cfg, "head")

# The staff (super admin) login the admin-panel tests sign in with. It exists
# only in this test database; the password is reset on every start.
from sqlalchemy import create_engine, text  # noqa: E402

from app.core.security import hash_password  # noqa: E402

engine = create_engine(sync_url)
with engine.begin() as conn:
    conn.execute(text(
        "INSERT INTO users (id, email, password_hash, full_name, is_active, platform_role) "
        "VALUES (gen_random_uuid(), :email, :hash, 'E2E Staff', true, 'super_admin') "
        "ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
        "is_active = true, platform_role = 'super_admin'"
    ), {"email": e2e_env.STAFF_EMAIL, "hash": hash_password(e2e_env.STAFF_PASSWORD)})
engine.dispose()

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
