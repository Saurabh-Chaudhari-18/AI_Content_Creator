import enum


class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


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
