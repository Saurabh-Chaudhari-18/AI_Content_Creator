import enum

from sqlalchemy import Enum as SAEnum


def pg_enum(enum_cls, name: str) -> SAEnum:
    """PostgreSQL enum that stores the member VALUES ('draft'), not the
    Python names ('DRAFT'). SQLAlchemy's default is names — which would make
    every CHECK constraint written against lowercase values silently
    ineffective and raw SQL unreadable."""
    return SAEnum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])


class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class PlatformRole(str, enum.Enum):
    """Platform staff (the product owner's side). NULL on users = a customer.
    Never a workspace role: staff are not members of customer workspaces."""
    SUPER_ADMIN = "super_admin"


class WorkspaceStatus(str, enum.Enum):
    ACTIVE = "active"
    # Members can still sign in and read; every write and publish is blocked.
    SUSPENDED = "suspended"


class FeatureValueType(str, enum.Enum):
    BOOLEAN = "boolean"  # on / off
    LIMIT = "limit"      # on / off plus a number (NULL number = unlimited)


class SetupTokenPurpose(str, enum.Enum):
    ACCOUNT_SETUP = "account_setup"
    PASSWORD_RESET = "password_reset"


class AdminAlertType(str, enum.Enum):
    OVER_LIMIT = "over_limit"                # real usage is above the plan limit
    USAGE_MISMATCH = "usage_mismatch"        # usage_logs disagrees with the real tables
    USAGE_SPIKE = "usage_spike"
    REPEAT_SIGNUPS = "repeat_signups"
    HIGH_FAILURE_RATE = "high_failure_rate"
    # Client approval links (0007)
    LINK_GUESSING = "link_guessing"          # many invalid link tokens from one IP
    LINK_VOLUME_SPIKE = "link_volume_spike"  # one workspace creating unusually many links


class AlertSeverity(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(str, enum.Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class ThemePreference(str, enum.Enum):
    """Per-user UI colour scheme. SYSTEM follows the device setting."""
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class PostStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    SCHEDULED = "scheduled"
    PUBLISHING = "publishing"
    PUBLISHED = "published"
    # One post → many platform jobs; some succeeded, some failed.
    PARTIALLY_PUBLISHED = "partially_published"
    FAILED = "failed"


class ApprovalAction(str, enum.Enum):
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    INVALIDATED = "invalidated"
    # The assignee changed while pending (by a person, or by the system when
    # the assignee lost approval rights). Added in 0007.
    REASSIGNED = "reassigned"


class ApprovalLinkDecision(str, enum.Enum):
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"


class NotificationType(str, enum.Enum):
    ASSIGNED = "assigned"
    CLIENT_APPROVED = "client_approved"
    CLIENT_CHANGES_REQUESTED = "client_changes_requested"
    MANAGER_APPROVED = "manager_approved"
    MANAGER_REJECTED = "manager_rejected"
    LINK_EXPIRED = "link_expired"
    ASSIGNMENT_RELEASED = "assignment_released"
    # Approval deadlines (0009)
    APPROVAL_DUE_SOON = "approval_due_soon"
    APPROVAL_OVERDUE = "approval_overdue"
    APPROVAL_ESCALATED = "approval_escalated"


class ReminderStage(str, enum.Enum):
    """One row per stage per review round (0009). manual_nudge = a person
    tapped "Send reminder"; it may repeat, the system stages may not."""
    DUE_SOON = "due_soon"
    OVERDUE = "overdue"
    ESCALATED = "escalated"
    MANUAL_NUDGE = "manual_nudge"


class ReminderChannel(str, enum.Enum):
    IN_APP = "in_app"
    WHATSAPP = "whatsapp"   # the agency's own WhatsApp (wa.me) — we never send it
    EMAIL = "email"         # the agency's own mail app (mailto:)
    COPY = "copy"           # copied to the clipboard


class SocialPlatform(str, enum.Enum):
    FACEBOOK = "facebook"
    INSTAGRAM = "instagram"
    LINKEDIN = "linkedin"


class MediaType(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"
    CAROUSEL_ITEM = "carousel_item"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    # A previous attempt crashed after dispatch — outcome unknown. A human
    # verifies on the platform before any retry (double-publish protection).
    NEEDS_REVIEW = "needs_review"


class OperationType(str, enum.Enum):
    POST_CREATED = "post_created"
    POST_PUBLISHED = "post_published"
    MEDIA_UPLOADED = "media_uploaded"
    AI_GENERATION = "ai_generation"  # reserved for Phase 2


class TemplateCategory(str, enum.Enum):
    PROMOTIONAL = "promotional"
    EDUCATIONAL = "educational"
    ENGAGEMENT = "engagement"
    SEASONAL = "seasonal"


class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    PUBLISH = "PUBLISH"
    SUBMIT = "SUBMIT"
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    SCHEDULE = "SCHEDULE"
    CONNECT = "CONNECT"
    DISCONNECT = "DISCONNECT"
    INVITE = "INVITE"
    ROLE_CHANGE = "ROLE_CHANGE"
    # Platform staff actions (admin panel) — added in 0005_admin_platform.
    VIEW = "VIEW"                              # staff opened customer content
    SUSPEND = "SUSPEND"
    REACTIVATE = "REACTIVATE"
    PLAN_CHANGE = "PLAN_CHANGE"
    FEATURE_CHANGE = "FEATURE_CHANGE"
    SETTING_CHANGE = "SETTING_CHANGE"
    OWNERSHIP_TRANSFER = "OWNERSHIP_TRANSFER"
    SETUP_LINK = "SETUP_LINK"
    FORCE_LOGOUT = "FORCE_LOGOUT"
    ALERT_UPDATE = "ALERT_UPDATE"
    # Approver picker & client approval links — added in 0007.
    SHARE_LINK = "SHARE_LINK"
    REVOKE_LINK = "REVOKE_LINK"
    ASSIGN = "ASSIGN"
    CONTACT_CHANGE = "CONTACT_CHANGE"
