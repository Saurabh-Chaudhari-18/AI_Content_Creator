import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class Brand(Base):
    __tablename__ = "brands"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    industry = Column(String(100), nullable=True)
    target_audience = Column(Text, nullable=True)
    tone_of_voice = Column(String(100), nullable=True)
    language = Column(String(10), nullable=False, default="en")
    logo_url = Column(String(500), nullable=True)
    brand_guidelines = Column(JSONB, nullable=False, default=dict)  # palette, typography, banned terms
    is_active = Column(Boolean, nullable=False, server_default="true")
    # Approval deadlines (0009). NULL = the workspace default.
    approval_due_hours = Column(Integer, nullable=True)
    approval_escalate_after_hours = Column(Integer, nullable=True)
    approval_release_when_overdue = Column(Boolean, nullable=False, server_default="false", default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    workspace = relationship("Workspace", back_populates="brands")
    posts = relationship("Post", back_populates="brand", cascade="all, delete-orphan")
