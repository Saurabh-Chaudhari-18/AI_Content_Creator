"""Approver picker & client approval links (migration 0007).

- BrandContact: a client person saved per brand, who can be asked to approve
  through a no-login link.
- ApprovalLink: one shareable link for one pending post. Only the SHA-256 of
  the token is stored; the raw token is shown once, at creation.
- Notification: the in-app bell.

Plan: docs/client_approval_link_plan.md.
"""
import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, func, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import ApprovalLinkDecision, NotificationType, pg_enum


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
