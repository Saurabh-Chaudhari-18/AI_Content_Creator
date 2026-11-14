"""Schemas for the approver picker, saved client contacts, client approval
links (agency side and public side) and in-app notifications."""
import re
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.schemas import PostResponse

_PHONE = re.compile(r"^\+[1-9]\d{6,14}$")  # E.164


def _clean_phone(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = re.sub(r"[\s\-().]", "", v)
    if not v:
        return None
    if v.startswith("00"):
        v = "+" + v[2:]
    if not _PHONE.match(v):
        raise ValueError("Enter the phone number with its country code, e.g. +91 98765 43210")
    return v


# ── Assigning a reviewer ──────────────────────────────────────────────
class ReviewerChoice(BaseModel):
    """Who to ask: a manager, a saved client contact, or neither (any manager)."""
    assign_to_user_id: Optional[UUID] = None
    assign_to_contact_id: Optional[UUID] = None
    # Only used when a client contact is chosen (a link is created).
    expires_in_minutes: Optional[int] = Field(None, ge=1)

    @model_validator(mode="after")
    def one_reviewer(self):
        if self.assign_to_user_id and self.assign_to_contact_id:
            raise ValueError("Pick one reviewer: a manager or a client, not both.")
        return self


class NewLinkResponse(BaseModel):
    id: UUID
    url: str             # shown ONCE — the token is not stored
    recipient_name: str
    recipient_phone: Optional[str] = None   # to prefill wa.me when known
    recipient_email: Optional[str] = None
    expires_at: datetime
    expiry_minutes: int


class SubmitResponse(PostResponse):
    approval_link: Optional[NewLinkResponse] = None


class ManagerOption(BaseModel):
    user_id: UUID
    name: str
    role: str   # owner | admin  (the app shows "admin" as Manager)


class ContactOption(BaseModel):
    contact_id: UUID
    name: str
    role_label: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class SuggestedReviewer(BaseModel):
    kind: Literal["manager", "contact"]
    id: UUID
    name: str


class ApproversResponse(BaseModel):
    managers: list[ManagerOption]
    contacts: list[ContactOption]
    suggested: Optional[SuggestedReviewer] = None
    # Set when the previous reviewer can no longer be picked (D11).
    suggestion_note: Optional[str] = None
    can_add_contacts: bool
    client_links_enabled: bool


# ── Saved client contacts ─────────────────────────────────────────────
class BrandContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    role_label: Optional[str] = Field(None, max_length=80)
    phone: Optional[str] = Field(None, max_length=32)
    email: Optional[EmailStr] = None

    @field_validator("phone")
    @classmethod
    def phone_e164(cls, v: Optional[str]) -> Optional[str]:
        return _clean_phone(v)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter the client's name")
        return v

    @model_validator(mode="after")
    def reachable(self):
        if not self.phone and not self.email:
            raise ValueError("Add a phone number or an email address")
        return self


class BrandContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    role_label: Optional[str] = Field(None, max_length=80)
    phone: Optional[str] = Field(None, max_length=32)
    email: Optional[EmailStr] = None

    @field_validator("phone")
    @classmethod
    def phone_e164(cls, v: Optional[str]) -> Optional[str]:
        return _clean_phone(v)


class BrandContactResponse(BaseModel):
    id: UUID
    brand_id: UUID
    name: str
    role_label: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    forgotten: bool = False
    created_at: datetime


# ── Links (agency side) ───────────────────────────────────────────────
class ApprovalLinkCreate(BaseModel):
    contact_id: Optional[UUID] = None
    recipient_name: Optional[str] = Field(None, max_length=120)
    recipient_contact: Optional[str] = Field(None, max_length=255)
    expires_in_minutes: Optional[int] = Field(None, ge=1)

    @model_validator(mode="after")
    def who(self):
        if not self.contact_id and not (self.recipient_name or "").strip():
            raise ValueError("Pick a saved client contact or enter the client's name")
        return self


class ApprovalLinkResponse(BaseModel):
    id: UUID
    post_id: UUID
    contact_id: Optional[UUID] = None
    recipient_name: str
    status: str   # not_opened | opened | approved | changes_requested | expired | revoked | out_of_date
    version_at_share: int
    expiry_minutes: int
    expires_at: datetime
    view_count: int
    first_viewed_at: Optional[datetime] = None
    last_viewed_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    created_by: UUID
    resent_from_id: Optional[UUID] = None
    created_at: datetime
    can_resend: bool = False


class LinkOptionsResponse(BaseModel):
    presets: list[int]            # minutes the caller may choose
    default_minutes: int          # the workspace default (preselected)
    min_minutes: int
    max_minutes: int              # platform max
    max_for_you: int              # members: the workspace default
    workspace_default_minutes: Optional[int] = None   # NULL = following the platform default


# ── Notifications ─────────────────────────────────────────────────────
class NotificationResponse(BaseModel):
    id: UUID
    type: str
    post_id: Optional[UUID] = None
    actor_name: Optional[str] = None
    message: str
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread: int
    page: int
    limit: int


class UnreadCountResponse(BaseModel):
    unread: int


# ── Public (client) side ──────────────────────────────────────────────
class PublicTokenRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class PublicDecideRequest(PublicTokenRequest):
    decision: Literal["approve", "request_changes"]
    name: str = Field(..., min_length=1, max_length=120)
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter your name")
        return v

    @model_validator(mode="after")
    def note_for_changes(self):
        if self.decision == "request_changes" and not (self.note or "").strip():
            raise ValueError("Tell the agency what to change")
        return self


class PublicPlatformPreview(BaseModel):
    platform: str
    text: str
    character_count: int


class PublicMedia(BaseModel):
    url: str
    media_type: str
    alt_text: Optional[str] = None


class PublicReceipt(BaseModel):
    decision: str            # approved | changes_requested
    name: str
    decided_at: datetime
    version: int
    fingerprint: str         # first 12 characters of the content hash


class PublicViewResponse(BaseModel):
    state: str               # open | expired | already_decided | already_reviewed | changed
    message: Optional[str] = None
    agency_name: str
    brand_name: str
    brand_logo_url: Optional[str] = None
    recipient_name: str
    version: int
    expires_at: datetime
    server_now: datetime
    platforms: list[PublicPlatformPreview] = []
    media: list[PublicMedia] = []
    receipt: Optional[PublicReceipt] = None
