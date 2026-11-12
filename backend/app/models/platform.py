"""Platform-level tables — owned by the product owner, not by a workspace.

Plans, feature switches, per-customer overrides, platform settings, login
setup links, and the usage / alert tables behind the admin panel. Values in
these tables are changed from the admin panel only; see
docs/omnipost-docs/08_admin_panel_database.md.
"""
import uuid

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.base import Base
from app.models.enums import (
    AdminAlertType, AlertSeverity, AlertStatus, FeatureValueType,
    SetupTokenPurpose, pg_enum,
)


class Plan(Base):
    """What a customer can buy (free, pro, ...). Never deleted: retired
    plans are deactivated so existing customers keep them."""
    __tablename__ = "plans"
    __table_args__ = (
        # Exactly one plan can be the one new sign-ups get.
        Index("uq_plans_single_default", "is_default", unique=True,
              postgresql_where=text("is_default")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(50), unique=True, nullable=False)  # stable code name
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, nullable=False, server_default="false")
    is_active = Column(Boolean, nullable=False, server_default="true")
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class Feature(Base):
    """One switchable feature. Rows mirror app/core/features.py — code
    defines which keys exist, the admin panel only flips global_enabled."""
    __tablename__ = "features"

    key = Column(String(100), primary_key=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=False, server_default="")
    value_type = Column(pg_enum(FeatureValueType, "feature_value_type"), nullable=False)
    category = Column(String(50), nullable=False)
    # Kill switch: false turns the feature off for everyone, whatever their plan.
    global_enabled = Column(Boolean, nullable=False, server_default="true")
    # False once the feature is removed from the code registry.
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class PlanFeature(Base):
    """What a plan includes. No row for a (plan, feature) pair means OFF."""
    __tablename__ = "plan_features"
    __table_args__ = (
        CheckConstraint("limit_value IS NULL OR limit_value >= 0", name="ck_plan_features_limit_non_negative"),
    )

    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True)
    feature_key = Column(String(100), ForeignKey("features.key"), primary_key=True, index=True)
    enabled = Column(Boolean, nullable=False)
    limit_value = Column(BigInteger, nullable=True)  # limit features only; NULL = unlimited
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class WorkspaceFeatureOverride(Base):
    """A per-customer exception to the plan. 'Default' = no row."""
    __tablename__ = "workspace_feature_overrides"
    __table_args__ = (
        UniqueConstraint("workspace_id", "feature_key", name="uq_workspace_feature_override"),
        CheckConstraint("limit_value IS NULL OR limit_value >= 0", name="ck_feature_override_limit_non_negative"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    feature_key = Column(String(100), ForeignKey("features.key"), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False)
    limit_value = Column(BigInteger, nullable=True)  # NULL = unlimited
    # Trials: once past, the override is ignored and the plan value applies again.
    expires_at = Column(DateTime(timezone=True), nullable=True)
    reason = Column(Text, nullable=False)
    set_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class PlatformSetting(Base):
    """Any other admin-controlled setting (key -> JSON value). Keys and
    defaults are defined in code; only the value changes from the panel."""
    __tablename__ = "platform_settings"

    key = Column(String(100), primary_key=True)
    value = Column(JSONB, nullable=False)
    value_type = Column(String(20), nullable=False)  # boolean | integer | string | json
    description = Column(Text, nullable=False, server_default="")
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class UserSetupToken(Base):
    """One-time 'set your password' link. Only the SHA-256 hash is stored,
    so neither the database nor the super admin ever holds a usable link
    after it is shown once."""
    __tablename__ = "user_setup_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    purpose = Column(pg_enum(SetupTokenPurpose, "setup_token_purpose"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UsageDaily(Base):
    """Per-workspace usage for one UTC day, counted by a nightly job from the
    real tables — an independent count, so a bug in limit enforcement or in
    usage logging shows up as a difference instead of going unnoticed."""
    __tablename__ = "usage_daily"

    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    day = Column(Date, primary_key=True, index=True)
    metric = Column(String(100), primary_key=True)
    actual_value = Column(BigInteger, nullable=False)   # counted from posts, publish_jobs, post_media...
    logged_value = Column(BigInteger, nullable=True)    # counted from usage_logs, where that applies
    computed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AdminAlert(Base):
    """Something the product owner should look at (over limit, mismatch, spike)."""
    __tablename__ = "admin_alerts"
    __table_args__ = (
        # One live alert per subject: the nightly job updates it instead of
        # inserting a duplicate every night.
        Index("uq_admin_alerts_live_dedupe", "dedupe_key", unique=True,
              postgresql_where=text("status <> 'resolved'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    alert_type = Column(pg_enum(AdminAlertType, "admin_alert_type"), nullable=False, index=True)
    severity = Column(pg_enum(AlertSeverity, "alert_severity"), nullable=False, server_default="warning")
    status = Column(pg_enum(AlertStatus, "alert_status"), nullable=False, server_default="open", index=True)
    details = Column(JSONB, nullable=False, default=dict)
    dedupe_key = Column(String(200), nullable=False)
    first_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolution_note = Column(Text, nullable=True)
