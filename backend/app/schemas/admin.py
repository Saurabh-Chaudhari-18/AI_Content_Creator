"""Request and response shapes for the admin API (/api/v1/admin).

Every request that changes something carries a `reason`: it is stored in
the audit trail, so "why does this customer have that?" has an answer later.
"""
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.enums import PlatformRole, TemplateCategory, WorkspaceRole
from app.schemas.schemas import (
    ApprovalLogResponse, JobResponse, NAME_MAX, PostResponse,
)

REASON_MIN, REASON_MAX = 3, 500


class Reasoned(BaseModel):
    reason: str = Field(..., min_length=REASON_MIN, max_length=REASON_MAX)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, v: str) -> str:
        v = v.strip()
        if len(v) < REASON_MIN:
            raise ValueError("Give a short reason for this change.")
        return v


class Paged(BaseModel):
    total: int
    page: int
    limit: int


# ── Overview ──────────────────────────────────────────────────────────
class ApprovalStats(BaseModel):
    """Client-approval funnel over the last `window_days` (counts only)."""
    window_days: int
    links_created: int
    links_opened: int
    client_approved: int
    client_changes_requested: int
    links_expired_unanswered: int
    median_client_response_minutes: Optional[float] = None
    approvals_by_client: int
    approvals_by_manager: int
    on_behalf_percent: Optional[float] = None
    saved_contacts: int
    workspaces_using_links: Optional[int] = None   # overview only


class AdminOverview(BaseModel):
    workspaces_total: int
    workspaces_suspended: int
    workspaces_by_plan: dict[str, int]
    users_total: int
    users_active: int
    users_signed_in_last_30_days: int
    posts_total: int
    posts_created_last_30_days: int
    posts_published_last_30_days: int
    jobs_failed: int
    jobs_needing_review: int
    open_alerts: int
    client_approvals: Optional[ApprovalStats] = None
    database_role: str   # the PostgreSQL role this API runs as — expected: omnipost_admin


# ── Workspaces ────────────────────────────────────────────────────────
class AdminWorkspace(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    plan_key: str
    plan_name: str
    owner_id: UUID
    owner_email: str
    owner_name: str
    member_count: int
    allow_self_approval: bool
    suspended_at: Optional[datetime] = None
    suspended_reason: Optional[str] = None
    created_at: datetime


class AdminWorkspaceDetail(AdminWorkspace):
    brand_count: int
    post_count: int
    social_account_count: int
    approvals: Optional[ApprovalStats] = None


class AdminWorkspaceList(Paged):
    items: list[AdminWorkspace]


class AdminWorkspaceCreate(Reasoned):
    name: str = Field(..., min_length=1, max_length=NAME_MAX)
    owner_email: EmailStr
    plan_key: Optional[str] = Field(None, max_length=50)   # default: the default plan


class AdminWorkspaceUpdate(Reasoned):
    name: Optional[str] = Field(None, min_length=1, max_length=NAME_MAX)
    plan_key: Optional[str] = Field(None, max_length=50)

    @model_validator(mode="after")
    def something_to_change(self):
        if self.name is None and self.plan_key is None:
            raise ValueError("Nothing to change: send name or plan_key.")
        return self


class TransferOwnership(Reasoned):
    new_owner_user_id: UUID


class AdminMember(BaseModel):
    user_id: UUID
    email: str
    full_name: str
    is_active: bool
    role: str
    joined_at: datetime


class AdminMemberAdd(Reasoned):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.MEMBER


class AdminMemberRole(Reasoned):
    role: WorkspaceRole


# ── Features: per-workspace view and overrides ────────────────────────
class FeatureOverride(BaseModel):
    enabled: bool
    limit: Optional[int] = None
    expires_at: Optional[datetime] = None
    expired: bool
    reason: str
    set_by_user_id: UUID
    updated_at: datetime


class AdminWorkspaceFeature(BaseModel):
    key: str
    name: str
    category: str
    value_type: str
    # What the customer gets right now, and which rule decided it.
    enabled: bool
    limit: Optional[int] = None
    source: str                       # global_off | override | plan | none
    # What their plan says, before any override.
    plan_enabled: bool
    plan_limit: Optional[int] = None
    override: Optional[FeatureOverride] = None


class AdminWorkspaceFeatures(BaseModel):
    workspace_id: UUID
    plan_key: str
    features: list[AdminWorkspaceFeature]


class FeatureValueIn(Reasoned):
    enabled: bool
    limit: Optional[int] = Field(None, ge=0)   # limit features only; null = unlimited


class FeatureOverrideIn(FeatureValueIn):
    expires_at: Optional[datetime] = None      # for trials; null = until removed

    @field_validator("expires_at")
    @classmethod
    def must_be_aware(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None and v.tzinfo is None:
            raise ValueError("expires_at must include a timezone offset (ISO 8601)")
        return v


# ── Users ─────────────────────────────────────────────────────────────
class AdminUser(BaseModel):
    id: UUID
    email: str
    full_name: str
    is_active: bool
    platform_role: Optional[str] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime
    workspace_count: int = 0


class AdminUserList(Paged):
    items: list[AdminUser]


class AdminMembership(BaseModel):
    workspace_id: UUID
    workspace_name: str
    workspace_status: str
    role: str


class AdminSession(BaseModel):
    id: UUID
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime
    expires_at: datetime


class PendingSetupLink(BaseModel):
    purpose: str
    expires_at: datetime
    created_at: datetime


class AdminUserDetail(AdminUser):
    memberships: list[AdminMembership]
    sessions: list[AdminSession]
    pending_setup_link: Optional[PendingSetupLink] = None


class AdminUserCreate(Reasoned):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=NAME_MAX)
    # Put the new login in an existing workspace...
    workspace_id: Optional[UUID] = None
    role: WorkspaceRole = WorkspaceRole.MEMBER
    # ...or give it a new workspace of its own (it becomes the owner).
    new_workspace_name: Optional[str] = Field(None, min_length=1, max_length=NAME_MAX)
    plan_key: Optional[str] = Field(None, max_length=50)   # for the new workspace

    @field_validator("full_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Full name cannot be empty")
        return v

    @model_validator(mode="after")
    def one_destination(self):
        if self.workspace_id is not None and self.new_workspace_name is not None:
            raise ValueError("Choose an existing workspace or a new one, not both.")
        return self


class AdminUserUpdate(Reasoned):
    full_name: Optional[str] = Field(None, min_length=1, max_length=NAME_MAX)
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def something_to_change(self):
        if self.full_name is None and self.is_active is None:
            raise ValueError("Nothing to change: send full_name or is_active.")
        return self


class SetupLinkResponse(BaseModel):
    """`setup_link` is shown ONCE. Only its hash is stored, so it cannot be
    looked up again — issue a new link if it is lost."""
    user_id: UUID
    email: str
    setup_link: str
    expires_at: datetime
    workspace_id: Optional[UUID] = None


class PlatformRoleIn(Reasoned):
    platform_role: Optional[PlatformRole] = None   # null = an ordinary customer login


class ForceLogoutResponse(BaseModel):
    sessions_ended: int


# ── Plans, features, settings ─────────────────────────────────────────
class PlanFeatureValue(BaseModel):
    enabled: bool
    limit: Optional[int] = None


class AdminPlan(BaseModel):
    id: UUID
    key: str
    name: str
    description: Optional[str] = None
    is_default: bool
    is_active: bool
    sort_order: int
    workspace_count: int
    features: dict[str, PlanFeatureValue]   # every active feature; missing in the plan = off


class AdminPlanCreate(Reasoned):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{1,49}$")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    sort_order: int = 0
    copy_from_key: Optional[str] = Field(None, max_length=50)   # start with another plan's values


class AdminPlanUpdate(Reasoned):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class AdminFeature(BaseModel):
    key: str
    name: str
    description: str
    value_type: str
    category: str
    global_enabled: bool
    is_active: bool


class GlobalSwitchIn(Reasoned):
    global_enabled: bool


class AdminSetting(BaseModel):
    key: str
    value: Any
    value_type: str
    description: str
    default: Any
    minimum: Optional[int] = None
    maximum: Optional[int] = None
    updated_at: Optional[datetime] = None


class SettingIn(Reasoned):
    value: Any


# ── Caption templates ─────────────────────────────────────────────────
class AdminTemplateCreate(Reasoned):
    industry: str = Field(..., min_length=1, max_length=100)
    category: TemplateCategory = TemplateCategory.PROMOTIONAL
    title: str = Field(..., min_length=1, max_length=255)
    template_text: str = Field(..., min_length=1, max_length=5000)
    suggested_hashtags: list[str] = Field(default_factory=list, max_length=30)
    suggested_cta: Optional[str] = Field(None, max_length=255)


class AdminTemplateUpdate(Reasoned):
    industry: Optional[str] = Field(None, min_length=1, max_length=100)
    category: Optional[TemplateCategory] = None
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    template_text: Optional[str] = Field(None, min_length=1, max_length=5000)
    suggested_hashtags: Optional[list[str]] = Field(None, max_length=30)
    suggested_cta: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


# ── Customer content (read-only) ──────────────────────────────────────
class AdminPostRow(BaseModel):
    id: UUID
    brand_id: UUID
    brand_name: str
    author_email: str
    title: Optional[str] = None
    caption: str
    status: str
    media_count: int
    scheduled_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    created_at: datetime


class AdminPostList(Paged):
    items: list[AdminPostRow]


class AdminPostDetail(BaseModel):
    workspace_id: UUID
    brand_name: str
    author_email: str
    post: PostResponse
    history: list[ApprovalLogResponse]
    jobs: list[JobResponse]


class AdminSocialAccount(BaseModel):
    """No token fields: the admin database role cannot read them."""
    id: UUID
    platform: str
    account_name: str
    account_type: Optional[str] = None
    platform_account_id: str
    is_active: bool
    needs_reauth: bool
    token_expires_at: Optional[datetime] = None
    connected_at: datetime


# ── Usage ─────────────────────────────────────────────────────────────
class UsageRow(BaseModel):
    workspace_id: UUID
    workspace_name: str
    plan_key: str
    status: str
    # In the chosen period (`days`), from the usage log.
    posts_created: int
    posts_published: int
    media_uploaded_mb: float
    # Right now, counted from the real tables.
    brands: int
    members: int
    social_accounts: int
    media_stored_mb: float
    # This calendar month (UTC): the usage log, and the posts table as a cross-check.
    posts_logged_this_month: int
    posts_in_table_this_month: int
    limits: dict[str, Optional[int]]      # limit feature -> number, null = unlimited
    # Limit features the workspace is above. Not empty = the limit was
    # lowered after the fact, or a check is being bypassed.
    over_limit: list[str]
    # True when the posts table holds more posts for the month than the
    # usage log recorded: some code path created posts without logging them.
    usage_mismatch: bool


class UsageReport(Paged):
    days: int
    items: list[UsageRow]


# ── Audit ─────────────────────────────────────────────────────────────
class AuditRow(BaseModel):
    id: UUID
    created_at: datetime
    action: str
    entity_type: str
    entity_id: UUID
    workspace_id: Optional[UUID] = None
    user_id: Optional[UUID] = None
    user_email: str
    user_name: str
    actor_platform_role: Optional[str] = None
    reason: Optional[str] = None
    changes: dict[str, Any]
    ip_address: Optional[str] = None


class AuditList(Paged):
    items: list[AuditRow]
