"""Feature registry — the single list of features a plan or a customer can
have switched on or off.

This file DEFINES features; the database stores their VALUES (the `features`,
`plan_features` and `workspace_feature_overrides` tables), which the super
admin changes from the admin panel. A feature only does something if code
checks it, so a new feature is always added here first.

Adding a feature: add a FeatureDef below, check it in the route or worker
that it gates, and add its row to the database (startup sync, or a
migration until that exists). Never rename a key — plans and overrides
reference it. See docs/omnipost-docs/08_admin_panel_database.md.
"""
from dataclasses import dataclass

from app.models.enums import FeatureValueType

_BOOL = FeatureValueType.BOOLEAN
_LIMIT = FeatureValueType.LIMIT


@dataclass(frozen=True)
class FeatureDef:
    key: str
    name: str
    description: str
    value_type: FeatureValueType
    category: str
    # Kill-switch value the row is first created with. False = the feature
    # exists in plans but stays off for everyone until it is released.
    global_enabled: bool = True


FEATURES: tuple[FeatureDef, ...] = (
    # ── Publishing ────────────────────────────────────────────────────
    FeatureDef("facebook_publishing", "Facebook publishing",
               "Connect Facebook pages and publish to them.", _BOOL, "Publishing"),
    FeatureDef("instagram_publishing", "Instagram publishing",
               "Connect Instagram business accounts and publish to them.", _BOOL, "Publishing"),
    FeatureDef("linkedin_publishing", "LinkedIn publishing",
               "Connect LinkedIn profiles and pages and publish to them.", _BOOL, "Publishing"),
    FeatureDef("scheduling", "Scheduling and calendar",
               "Schedule posts for a later time and see them on the calendar.", _BOOL, "Publishing"),
    FeatureDef("max_social_accounts", "Connected social accounts",
               "How many social accounts the workspace can connect.", _LIMIT, "Publishing"),
    # ── Content ───────────────────────────────────────────────────────
    FeatureDef("caption_templates", "Smart Templates",
               "Use the caption template library when writing a post.", _BOOL, "Content"),
    FeatureDef("approval_workflow", "Approval workflow",
               "Require a second person to approve a post before it is published.", _BOOL, "Content"),
    FeatureDef("max_posts_per_month", "Posts per month",
               "How many posts the workspace can create in a calendar month.", _LIMIT, "Content"),
    # ── Workspace ─────────────────────────────────────────────────────
    FeatureDef("max_brands", "Brands",
               "How many brands the workspace can manage.", _LIMIT, "Workspace"),
    FeatureDef("max_members", "Team members",
               "How many people can belong to the workspace.", _LIMIT, "Workspace"),
    FeatureDef("usage_export", "Usage export",
               "Download the workspace's usage as a file.", _BOOL, "Workspace"),
    # ── Media ─────────────────────────────────────────────────────────
    FeatureDef("video_uploads", "Video uploads",
               "Attach videos to posts (images are always allowed).", _BOOL, "Media"),
    FeatureDef("max_storage_mb", "Media storage (MB)",
               "Total size of uploaded media the workspace can keep, in megabytes.", _LIMIT, "Media"),
    # ── AI (Phase 2 — off for everyone until released) ────────────────
    FeatureDef("ai_captions", "AI captions",
               "Generate captions with AI.", _BOOL, "AI", global_enabled=False),
    FeatureDef("max_ai_tokens_per_month", "AI tokens per month",
               "How many AI tokens the workspace can use in a calendar month.", _LIMIT, "AI",
               global_enabled=False),
)

FEATURES_BY_KEY: dict[str, FeatureDef] = {f.key: f for f in FEATURES}

if len(FEATURES_BY_KEY) != len(FEATURES):  # pragma: no cover — guards a copy-paste slip
    raise RuntimeError("Duplicate feature key in app/core/features.py")
