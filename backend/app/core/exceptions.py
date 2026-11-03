"""Application exception taxonomy."""


class AppError(Exception):
    """Base class for application errors."""


# ── Publishing taxonomy (adapters + Celery tasks) ─────────────────────
class PublishError(AppError):
    pass


class RetryablePublishError(PublishError):
    """Temporary failure: rate limit, timeout, 5xx. The task retries."""


class PermanentPublishError(PublishError):
    """Permanent failure: invalid token, permissions, content policy. No retry."""
