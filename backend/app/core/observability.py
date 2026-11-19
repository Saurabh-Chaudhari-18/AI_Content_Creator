"""Error reporting (Sentry) for the API, the workers and beat.

Off unless SENTRY_DSN is set, so local development and tests send nothing.

Privacy: customers' content and credentials must never leave for Sentry.
- send_default_pii=False: no cookies, no client IP, no logged-in user data;
- request bodies are never attached (captions, client names, passwords);
- Sentry's own scrubber also blanks keys like password / token / secret /
  authorization / cookie / csrf wherever they appear.
"""
import logging

from app.config import settings

logger = logging.getLogger("app")


def init_error_reporting(component: str) -> bool:
    """Start Sentry for one process kind ("api", "worker"). Returns True if on."""
    if not settings.SENTRY_DSN:
        return False
    import sentry_sdk
    from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT or settings.ENVIRONMENT,
        release=settings.APP_VERSION,
        send_default_pii=False,
        max_request_body_size="never",
        event_scrubber=EventScrubber(denylist=[*DEFAULT_DENYLIST, "refresh_token", "fernet", "access_token_encrypted"]),
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
    )
    sentry_sdk.set_tag("component", component)
    logger.info("error reporting on (component=%s)", component)
    return True
