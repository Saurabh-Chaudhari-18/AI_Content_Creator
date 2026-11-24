"""Outgoing email: queueing, wording and delivery.

Plan: docs/approval_reminders_certificate_plan.md §10.

How it works
- Code that wants to send an email calls `queue(...)`, which only adds an
  `email_outbox` row to the caller's own transaction: the email exists if
  and only if the thing it is about was committed.
- The Beat job `send_queued_emails` (workers/tasks/email.py) delivers
  queued rows through the configured backend, retries a few times, and wipes
  the body afterwards.
- Who gets email: users who left "email me about approvals" on, in a
  workspace whose plan includes `email_notifications`; client contacts only
  when the workspace switched client reminders on and the client has not
  opted out. In-app notifications never depend on any of this.

Backends (settings.EMAIL_BACKEND): console (log, development), smtp, off,
memory (tests read `SENT`).
"""
import hashlib
import hmac
import html
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from uuid import UUID

from sqlalchemy import select

from app.config import settings
from app.models import BrandContact, EmailOutbox, EmailStatus, User
from app.services.encryption import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
SENT: list["Outgoing"] = []   # the "memory" backend (tests)


@dataclass(frozen=True)
class Recipient:
    email: str
    name: str | None = None

    @property
    def first_name(self) -> str:
        return (self.name or "").split(" ")[0] or "there"


@dataclass(frozen=True)
class Outgoing:
    to_email: str
    to_name: str | None
    subject: str
    text: str
    reply_to: str | None = None
    kind: str = ""


# ── Recipients ─────────────────────────────────────────────────────────
def _wants_email():
    return (User.is_active.is_(True), User.email_notifications.is_(True))


async def user_recipients(db, user_ids, *, exclude: UUID | None = None) -> list[Recipient]:
    ids = {u for u in user_ids if u is not None and u != exclude}
    if not ids:
        return []
    rows = (await db.execute(select(User.email, User.full_name).where(User.id.in_(ids), *_wants_email()))).all()
    return [Recipient(email, name) for email, name in rows]


def user_recipients_sync(db, user_ids, *, exclude: UUID | None = None) -> list[Recipient]:
    ids = {u for u in user_ids if u is not None and u != exclude}
    if not ids:
        return []
    rows = db.execute(select(User.email, User.full_name).where(User.id.in_(ids), *_wants_email())).all()
    return [Recipient(email, name) for email, name in rows]


def contact_can_be_emailed(contact: BrandContact | None) -> bool:
    return bool(contact and contact.email and contact.is_active and contact.forgotten_at is None
                and contact.email_opt_out_at is None)


# ── Queueing ───────────────────────────────────────────────────────────
def queue(db, *, kind: str, to: Recipient, subject: str, text: str, workspace_id: UUID | None = None,
          post_id: UUID | None = None, reply_to: str | None = None) -> None:
    """Add one email to the caller's transaction (sync or async session:
    it only calls add). Nothing is queued when this server has email off."""
    if not settings.email_enabled:
        return
    db.add(EmailOutbox(
        workspace_id=workspace_id, post_id=post_id, kind=kind, to_email=to.email.strip().lower(),
        to_name=(to.name or None) and to.name[:120], reply_to=reply_to, subject=subject[:255],
        body_encrypted=encrypt_token(text), status=EmailStatus.QUEUED, attempts=0,
    ))


def kick() -> None:
    """Ask the worker to send now instead of at the next Beat tick. Best
    effort: Beat delivers within a minute anyway."""
    try:
        from app.workers.tasks.email import send_queued_emails

        send_queued_emails.apply_async()
    except Exception:  # noqa: BLE001 — broker down: Beat is the safety net
        logger.warning("could not dispatch send_queued_emails; Beat will send", exc_info=True)


# ── Wording ────────────────────────────────────────────────────────────
def post_url(post_id) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/posts/{post_id}"


def _signature(workspace_name: str | None) -> str:
    where = f" in {workspace_name}" if workspace_name else ""
    return (f"You get these emails because you approve posts{where} on {settings.PRODUCT_NAME}. "
            f"Turn them off in Settings: {settings.FRONTEND_URL.rstrip('/')}/settings")


def approval_email(*, to: Recipient, headline: str, post_id, workspace_name: str | None) -> tuple[str, str]:
    """Subject and body for a manager: the bell message plus a link."""
    text = (f"Hi {to.first_name},\n\n{headline}\n\nOpen the post: {post_url(post_id)}\n\n"
            f"{_signature(workspace_name)}")
    return headline[:150], text


def client_reminder_email(*, to: Recipient, agency: str, brand: str, post_title: str, when: str,
                          overdue: bool, sent_by: str | None, sent_on: str | None, stop_url: str) -> tuple[str, str]:
    """A reminder to a client. The link itself is not repeated: only its
    fingerprint is stored, so we point to the message that carried it."""
    subject = f"Reminder: a post for {brand} is waiting for your approval"
    deadline = f"It was needed by {when}." if overdue else f"It's needed by {when}."
    link = (f"Please use the approval link {sent_by or agency} sent you{f' on {sent_on}' if sent_on else ''}."
            " If you can't find it, reply to this email and they'll send it again.")
    text = (f"Hi {to.first_name},\n\n{agency} is waiting for your answer on the post \"{post_title}\" "
            f"for {brand}. {deadline}\n\n{link}\n\n"
            f"This reminder was sent by {settings.PRODUCT_NAME} for {agency}. "
            f"To stop these reminders, open: {stop_url}")
    return subject, text


def password_reset_email(*, to: Recipient, link: str, hours: int) -> tuple[str, str]:
    subject = f"Reset your {settings.PRODUCT_NAME} password"
    text = (f"Hi {to.first_name},\n\nSomeone asked to reset the password for this email address on "
            f"{settings.PRODUCT_NAME}. To choose a new password, open this link:\n\n{link}\n\n"
            f"It works once, for {hours} hours. If you didn't ask for this, ignore this email: "
            "your password stays as it is.")
    return subject, text


# ── Client opt-out links ───────────────────────────────────────────────
def _opt_out_signature(contact_id: UUID) -> str:
    digest = hmac.new(settings.SECRET_KEY.encode(), f"contact-email-opt-out:{contact_id}".encode(),
                      hashlib.sha256).hexdigest()
    return digest[:40]


def opt_out_token(contact_id: UUID) -> str:
    """Signed, never stored: it proves the holder received an email we sent
    to this contact. It can only switch that contact's reminders off."""
    return f"{contact_id}.{_opt_out_signature(contact_id)}"


def opt_out_url(contact_id: UUID) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/email/stop#{opt_out_token(contact_id)}"


def read_opt_out_token(token: str) -> UUID | None:
    try:
        raw_id, signature = (token or "").split(".", 1)
        contact_id = UUID(raw_id)
    except (ValueError, AttributeError):
        return None
    return contact_id if hmac.compare_digest(signature, _opt_out_signature(contact_id)) else None


# ── Delivery ───────────────────────────────────────────────────────────
def _as_html(text: str) -> str:
    """The same words as simple HTML: paragraphs, and links you can tap."""
    paragraphs = []
    for block in text.split("\n\n"):
        escaped = html.escape(block).replace("\n", "<br>")
        words = [f'<a href="{w}">{w}</a>' if w.startswith(("http://", "https://")) else w
                 for w in escaped.split(" ")]
        paragraphs.append(f"<p style=\"margin:0 0 14px\">{' '.join(words)}</p>")
    return ("<div style=\"font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;"
            f"line-height:1.5;color:#1a2030;max-width:560px\">{''.join(paragraphs)}</div>")


def build_message(out: Outgoing) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((settings.PRODUCT_NAME, settings.EMAIL_FROM_ADDRESS or "no-reply@localhost"))
    message["To"] = formataddr((out.to_name or "", out.to_email))
    message["Subject"] = out.subject
    if out.reply_to:
        message["Reply-To"] = out.reply_to
    message["Auto-Submitted"] = "auto-generated"   # so vacation responders stay quiet
    message.set_content(out.text)
    message.add_alternative(_as_html(out.text), subtype="html")
    return message


def deliver(out: Outgoing) -> None:
    """Send one email through the configured backend. Raises on failure."""
    backend = settings.EMAIL_BACKEND
    if backend == "memory":
        SENT.append(out)
    elif backend == "console":
        logger.info("[Email] to=%s subject=%s\n%s", out.to_email, out.subject, out.text)
    elif backend == "smtp":
        message = build_message(out)
        context = ssl.create_default_context()
        if settings.SMTP_SSL:
            client = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context,
                                      timeout=settings.SMTP_TIMEOUT_SECONDS)
        else:
            client = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT_SECONDS)
        with client:
            if settings.SMTP_STARTTLS and not settings.SMTP_SSL:
                client.starttls(context=context)
            if settings.SMTP_USERNAME:
                client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            client.send_message(message)
    else:  # "off": the row should never have been queued
        raise RuntimeError("Email is switched off on this server.")


def outgoing_from_row(row: EmailOutbox) -> Outgoing:
    return Outgoing(to_email=row.to_email, to_name=row.to_name, subject=row.subject,
                    text=decrypt_token(row.body_encrypted), reply_to=row.reply_to, kind=row.kind)
