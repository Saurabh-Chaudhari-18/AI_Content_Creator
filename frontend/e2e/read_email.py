"""Print the newest queued email of one kind to one address, decrypted.

Used by the browser tests to follow emailed links (password reset) without a
real mail provider: the test API queues emails in `email_outbox`, and no
worker sends them, so they stay there. Test database only.

    python frontend/e2e/read_email.py <to_email> <kind>
"""
import sys

import e2e_env

e2e_env.configure()

from sqlalchemy import create_engine, text  # noqa: E402

from app.services.encryption import decrypt_token  # noqa: E402

to_email, kind = sys.argv[1].strip().lower(), sys.argv[2]
engine = create_engine(e2e_env.os.environ["SYNC_DATABASE_URL"])
with engine.connect() as conn:
    body = conn.execute(text(
        "SELECT body_encrypted FROM email_outbox WHERE to_email = :to AND kind = :kind "
        "AND body_encrypted IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ), {"to": to_email, "kind": kind}).scalar()
engine.dispose()
if body is None:
    sys.exit(f"No {kind} email queued for {to_email}.")
sys.stdout.write(decrypt_token(body))
