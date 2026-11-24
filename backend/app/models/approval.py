"""Approver picker & client approval links (migration 0007).

- BrandContact: a client person saved per brand, who can be asked to approve
  through a no-login link.
- ApprovalLink: one shareable link for one pending post. Only the SHA-256 of
  the token is stored; the raw token is shown once, at creation.
- Notification: the in-app bell.
- ApprovalReminder (0009): one row per reminder of a review round.
- ApprovalCertificate (0009): written once, at approval; outlives the post.

Plans: docs/client_approval_link_plan.md, docs/approval_reminders_certificate_plan.md.
"""
import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import (
    ApprovalLinkDecision, EmailStatus, NotificationType, ReminderChannel, ReminderStage, pg_enum,
)


class BrandContact(Base):
    __tablename__ = "brand_contacts"
    __table_args__ = (
        # A forgotten contact (DPDP erasure) keeps only its name.
        CheckConstraint("phone IS NOT NULL OR email IS NOT NULL OR forgotten_at IS NOT NULL",
                        name="ck_brand_contacts_reachable"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    name = Column(String(120), nullable=False)
    role_label = Column(String(80), nullable=True)
    phone = Column(String(20), nullable=True)    # E.164, e.g. +919812345678
    email = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    forgotten_at = Column(DateTime(timezone=True), nullable=True)
    # The client pressed "stop these reminders" in an email (0010). Only the
    # client sets it; the agency can still share links by hand.
    email_opt_out_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ApprovalLink(Base):
    __tablename__ = "approval_links"
    __table_args__ = (
        CheckConstraint("(decision IS NULL) = (decided_at IS NULL)", name="ck_approval_links_decision_time"),
        CheckConstraint("expiry_minutes > 0", name="ck_approval_links_expiry_positive"),
        # The expiry-notification scan looks only at live, undecided links.
        Index("ix_approval_links_open_expiry", "expires_at",
              postgresql_where=text("decided_at IS NULL AND revoked_at IS NULL AND expiry_notified_at IS NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("brand_contacts.id"), nullable=True, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    content_hash_at_share = Column(String(64), nullable=False)
    version_at_share = Column(Integer, nullable=False)
    recipient_name = Column(String(120), nullable=False)
    recipient_contact = Column(String(255), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    expiry_minutes = Column(Integer, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    resent_from_id = Column(UUID(as_uuid=True), ForeignKey("approval_links.id"), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoke_reason = Column(String(40), nullable=True)
    expiry_notified_at = Column(DateTime(timezone=True), nullable=True)
    first_viewed_at = Column(DateTime(timezone=True), nullable=True)
    last_viewed_at = Column(DateTime(timezone=True), nullable=True)
    view_count = Column(Integer, nullable=False, server_default="0", default=0)
    decision = Column(pg_enum(ApprovalLinkDecision, "approval_link_decision"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    post = relationship("Post")
    contact = relationship("BrandContact")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(pg_enum(NotificationType, "notification_type"), nullable=False)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), nullable=True)
    actor_name = Column(String(120), nullable=True)
    message = Column(String(300), nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)


class ApprovalReminder(Base):
    """Append-only. The partial unique index (submission_log_id, stage) for
    system stages is what makes the Beat job send each stage once per round,
    even with two workers running."""
    __tablename__ = "approval_reminders"
    __table_args__ = (
        Index("uq_approval_reminders_stage_once", "submission_log_id", "stage", unique=True,
              postgresql_where=text("stage <> 'manual_nudge'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    submission_log_id = Column(UUID(as_uuid=True), ForeignKey("approval_logs.id", ondelete="CASCADE"),
                               nullable=False)
    stage = Column(pg_enum(ReminderStage, "reminder_stage"), nullable=False)
    channel = Column(pg_enum(ReminderChannel, "reminder_channel"), nullable=False)
    recipient_name = Column(String(120), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ApprovalCertificate(Base):
    """Proof of exactly what was approved. Written in the approval's own
    transaction and never updated: "superseded" and the publish outcome are
    worked out when it is read. post_id / approval_log_id go NULL when the
    post is deleted; the snapshot keeps the certificate meaningful."""
    __tablename__ = "approval_certificates"
    __table_args__ = (
        Index("uq_approval_certificates_log", "approval_log_id", unique=True,
              postgresql_where=text("approval_log_id IS NOT NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_id = Column(String(16), nullable=False, unique=True, index=True)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id", ondelete="SET NULL"), nullable=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True, index=True)
    approval_log_id = Column(UUID(as_uuid=True), ForeignKey("approval_logs.id", ondelete="SET NULL"),
                             nullable=True)
    content_hash = Column(String(64), nullable=False)
    version = Column(Integer, nullable=False)
    approved_at = Column(DateTime(timezone=True), nullable=False)
    snapshot = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class EmailOutbox(Base):
    """One outgoing email (0010). Requests and workers only INSERT a row; the
    Beat job `send_queued_emails` sends it, so a slow or broken mail server
    never slows a request or loses a message.

    The body is Fernet-encrypted (a password-reset email carries a usable
    link) and wiped as soon as the email is sent or given up on."""
    __tablename__ = "email_outbox"
    __table_args__ = (
        Index("ix_email_outbox_queued", "created_at", postgresql_where=text("status = 'queued'")),
        Index("ix_email_outbox_workspace_day", "workspace_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(40), nullable=False)
    to_email = Column(String(255), nullable=False)
    to_name = Column(String(120), nullable=True)
    reply_to = Column(String(255), nullable=True)
    subject = Column(String(255), nullable=False)
    body_encrypted = Column(Text, nullable=True)
    status = Column(pg_enum(EmailStatus, "email_status"), nullable=False, server_default="queued",
                    default=EmailStatus.QUEUED)
    attempts = Column(Integer, nullable=False, server_default="0", default=0)
    last_error = Column(String(300), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)
