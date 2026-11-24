"""Model registry — importing this package registers every table on Base.metadata."""
from app.models.enums import (
    AdminAlertType,
    AlertSeverity,
    AlertStatus,
    ApprovalAction,
    ApprovalLinkDecision,
    NotificationType,
    AuditAction,
    FeatureValueType,
    JobStatus,
    MediaType,
    OperationType,
    PlatformRole,
    PostStatus,
    ReminderChannel,
    ReminderStage,
    SetupTokenPurpose,
    SocialPlatform,
    TemplateCategory,
    ThemePreference,
    WorkspaceRole,
    WorkspaceStatus,
)
from app.models.user import RefreshToken, User
from app.models.workspace import Workspace, WorkspaceMember
from app.models.brand import Brand
from app.models.post import ApprovalLog, Post, PostMedia
from app.models.social_account import PublishJob, SocialAccount
from app.models.operational import AuditEvent, CaptionTemplate, UsageLog
from app.models.platform import (
    AdminAlert, Feature, Plan, PlanFeature, PlatformSetting, UsageDaily,
    UserSetupToken, WorkspaceFeatureOverride,
)
from app.models.approval import (
    ApprovalCertificate, ApprovalLink, ApprovalReminder, BrandContact, Notification,
)

__all__ = [
    "ApprovalAction", "AuditAction", "JobStatus", "MediaType", "OperationType",
    "PostStatus", "SocialPlatform", "TemplateCategory", "ThemePreference", "WorkspaceRole",
    "User", "RefreshToken", "Workspace", "WorkspaceMember", "Brand",
    "Post", "PostMedia", "ApprovalLog", "SocialAccount", "PublishJob",
    "UsageLog", "CaptionTemplate", "AuditEvent",
    "AdminAlertType", "AlertSeverity", "AlertStatus", "FeatureValueType",
    "PlatformRole", "SetupTokenPurpose", "WorkspaceStatus",
    "Plan", "Feature", "PlanFeature", "WorkspaceFeatureOverride", "PlatformSetting",
    "UserSetupToken", "UsageDaily", "AdminAlert",
    "ApprovalLinkDecision", "NotificationType", "ApprovalLink", "BrandContact", "Notification",
    "ApprovalReminder", "ApprovalCertificate", "ReminderStage", "ReminderChannel",
]
