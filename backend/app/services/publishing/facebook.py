import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings
from app.core.constants import PLATFORM_CHAR_LIMITS
from app.core.exceptions import PermanentPublishError, RetryablePublishError, UnknownOutcomePublishError
from app.services.meta_oauth import graph_url, meta_auth_params
from app.services.publishing.base import SocialPublishAdapter

logger = logging.getLogger(__name__)

# Meta error codes: 190/102 auth, 200-299 permissions; 1/2/4/17/341 transient
_AUTH_CODES = {190, 102}
_TRANSIENT_CODES = {1, 2, 4, 17, 341}


# Meta's "something went wrong on our side" codes. On the call that actually
# creates the post they mean the post MAY exist (1 = unknown error,
# 2 = service unavailable); rate limits (4, 17, 341) are refused up front.
_SERVER_SIDE_CODES = {1, 2}


def _classify_meta_error(status_code: int, err: dict, context: str, *, final_write: bool = False):
    """Raise the right publish error for a failed Graph API call.

    final_write=True for the request that creates the post itself (Facebook
    /feed or /photos, Instagram media_publish): a server-side failure there
    can arrive AFTER the post was created, so it is an unknown outcome for a
    person to check, never an automatic retry that could post twice."""
    code = err.get("code")
    msg = err.get("message", f"{context} failed")
    if code in _AUTH_CODES or (isinstance(code, int) and 200 <= code <= 299):
        raise PermanentPublishError(f"{context}: Facebook auth/permission error ({code}): {msg}")
    if final_write and (status_code >= 500 or code in _SERVER_SIDE_CODES):
        raise UnknownOutcomePublishError(
            f"{context}: Facebook server error ({status_code}, code {code}) after the post was sent: {msg}")
    if code in _TRANSIENT_CODES or status_code >= 500:
        raise RetryablePublishError(f"{context}: Facebook transient error ({code}): {msg}")
    raise PermanentPublishError(f"{context}: {msg}")


class FacebookAdapter(SocialPublishAdapter):
    platform = "facebook"

    def validate_media(self, media_urls: list[str]) -> list[str]:
        errors = []
        if len(media_urls) > 1:
            errors.append(
                "MVP supports a single image per Facebook post; carousel publishing arrives in Phase 2."
            )
        return errors

    def publish(self, caption, media_urls, access_token, account_metadata, hashtags=None, cta=None) -> dict[str, Any]:
        errors = self.validate_media(media_urls)
        if errors:
            raise PermanentPublishError("; ".join(errors))

        text = self.compose_text(caption, hashtags, cta)
        if len(text) > PLATFORM_CHAR_LIMITS["facebook"]:
            raise PermanentPublishError("Post exceeds Facebook's character limit.")

        # Mock simulation — NEVER honored in production (customers would see
        # fake "Published" results).
        if not settings.is_production and access_token.startswith("mock-"):
            mock_id = f"fb_mock_{uuid.uuid4().hex[:12]}"
            logger.info(f"[FacebookAdapter] MOCK publish: {mock_id}")
            return {
                "platform_post_id": mock_id,
                "url": f"https://facebook.com/{mock_id}",
                "published_at": datetime.now(timezone.utc).isoformat(),
                "mode": "mock_simulation",
            }

        page_id = account_metadata.get("page_id") or account_metadata.get("platform_account_id")
        if not page_id:
            raise PermanentPublishError("Missing page_id in Facebook account metadata.")

        try:
            with httpx.Client(timeout=30.0) as client:
                if media_urls:
                    endpoint = graph_url(f"/{page_id}/photos")
                    payload = {"url": media_urls[0], "message": text, **meta_auth_params(access_token)}
                else:
                    endpoint = graph_url(f"/{page_id}/feed")
                    payload = {"message": text, **meta_auth_params(access_token)}

                try:
                    resp = client.post(endpoint, data=payload)
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    # The request may have reached Facebook and been posted.
                    raise UnknownOutcomePublishError(f"Facebook publish request dropped: {exc}") from exc
                if resp.status_code == 200:
                    data = resp.json()
                    post_id = data.get("post_id") or data.get("id")
                    return {
                        "platform_post_id": post_id,
                        "url": f"https://facebook.com/{post_id}",
                        "published_at": datetime.now(timezone.utc).isoformat(),
                        "mode": "live_api",
                    }

                try:
                    err = resp.json().get("error", {})
                except Exception:  # noqa: BLE001 — non-JSON body (e.g. HTML 502)
                    err = {}
                _classify_meta_error(resp.status_code, err, "Facebook publish", final_write=True)

        except httpx.TimeoutException as exc:
            raise RetryablePublishError(f"Facebook request timed out: {exc}") from exc
        except httpx.NetworkError as exc:
            raise RetryablePublishError(f"Facebook network error: {exc}") from exc
        # NOTE: the final POST above raises UnknownOutcomePublishError itself and is
        # not a subclass of either, so it passes through untouched.
