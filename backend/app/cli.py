"""Command line tasks that must not be reachable from the web.

    python -m app.cli grant-super-admin owner@example.com
    python -m app.cli list-super-admins

Making the FIRST super admin is done here, on the server, by someone who
already has access to it — there is deliberately no web route that can turn
a login into platform staff without an existing super admin. After that,
staff are managed in the admin panel (PUT /admin/users/{id}/platform-role).
"""
import argparse
import sys

from sqlalchemy import select

from app.db.session import worker_session
from app.models import AuditAction, PlatformRole, User
from app.services.audit import record_audit_event


def grant_super_admin(email: str) -> int:
    with worker_session() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            print(f"No login with the email {email!r}. Register it first, then run this again.")
            return 1
        if not user.is_active:
            print(f"{user.email} is deactivated. Reactivate it first.")
            return 1
        if user.platform_role == PlatformRole.SUPER_ADMIN:
            print(f"{user.email} is already a super admin.")
            return 0
        user.platform_role = PlatformRole.SUPER_ADMIN
        record_audit_event(
            db, action=AuditAction.ROLE_CHANGE, entity_type="User", entity_id=user.id,
            workspace_id=None, user_id=None, user_email="(command line)", user_name="(command line)",
            changes={"before": {"platform_role": None}, "after": {"platform_role": "super_admin"}},
            reason="granted from the command line",
        )
        print(f"{user.email} is now a super admin.")
    return 0


def list_super_admins() -> int:
    with worker_session() as db:
        rows = db.execute(
            select(User.email, User.full_name, User.is_active, User.last_login_at)
            .where(User.platform_role == PlatformRole.SUPER_ADMIN).order_by(User.email)
        ).all()
    if not rows:
        print("There are no super admins yet. Create one with: python -m app.cli grant-super-admin <email>")
    for row in rows:
        state = "active" if row.is_active else "deactivated"
        print(f"{row.email}  {row.full_name}  ({state}, last sign-in: {row.last_login_at or 'never'})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    grant = commands.add_parser("grant-super-admin", help="make an existing login a super admin")
    grant.add_argument("email")
    commands.add_parser("list-super-admins", help="show who is a super admin")
    args = parser.parse_args(argv)
    if args.command == "grant-super-admin":
        return grant_super_admin(args.email)
    return list_super_admins()


if __name__ == "__main__":
    sys.exit(main())
