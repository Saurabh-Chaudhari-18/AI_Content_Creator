import uuid

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import WorkspaceRole, WorkspaceStatus, pg_enum


class Workspace(Base):
    """Root multi-tenancy partition — every customer asset is siloed here."""
    __tablename__ = "workspaces"
    __table_args__ = (
        CheckConstraint(
            "NOT (status = 'suspended' AND suspended_reason IS NULL)",
            name="ck_suspended_requires_reason",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # True: a post's author may approve it (one-person business, demo).
    # False: author != approver is enforced (agency / compliance).
    # Turned off automatically when the second member joins; owner can toggle.
    allow_self_approval = Column(Boolean, nullable=False, server_default="true")
    # Billing plan — decides which features and limits the workspace gets.
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False, index=True)
    # Set by platform staff. Suspended = members can read, nothing can be
    # written or published.
    status = Column(pg_enum(WorkspaceStatus, "workspace_status"), nullable=False,
                    default=WorkspaceStatus.ACTIVE, server_default=WorkspaceStatus.ACTIVE.value)
    suspended_at = Column(DateTime(timezone=True), nullable=True)
    suspended_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    brands = relationship("Brand", back_populates="workspace", cascade="all, delete-orphan")
    social_accounts = relationship("SocialAccount", back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(pg_enum(WorkspaceRole, "workspace_role"), nullable=False, default=WorkspaceRole.MEMBER)
    joined_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User", back_populates="workspace_memberships")
