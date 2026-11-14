"""Redis-backed fixed-window rate limiting.

Auth endpoints: per-IP (credential-stuffing defense).
Workspace routes: per-workspace (noisy-neighbor defense).
"""
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request

from app.config import settings
from app.core.dependencies import client_ip
from app.db.session import get_db

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def _hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    full_key = f"rl:{key}"
    r = get_redis()
    async with r.pipeline(transaction=True) as pipe:
        pipe.incr(full_key)
        pipe.ttl(full_key)
        count, ttl = await pipe.execute()
    if ttl == -1:
        await r.expire(full_key, window_seconds)
        ttl = window_seconds
    return count <= limit, max(ttl, 0)


async def auth_rate_limit(request: Request) -> None:
    """Dependency for /login and /register. Fails open if Redis is down —
    availability of login beats a hard dependency on the limiter."""
    try:
        allowed, retry_after = await _hit(
            f"auth:{client_ip(request)}",
            settings.RATE_LIMIT_AUTH_ATTEMPTS,
            settings.RATE_LIMIT_AUTH_WINDOW_SECONDS,
        )
    except Exception:  # noqa: BLE001
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )


async def workspace_rate_limit(request: Request) -> None:
    """Dependency for workspace-scoped routes (path param workspace_id)."""
    key = request.path_params.get("workspace_id") or client_ip(request)
    try:
        allowed, retry_after = await _hit(f"ws:{key}", settings.RATE_LIMIT_WORKSPACE_PER_MINUTE, 60)
    except Exception:  # noqa: BLE001
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for this workspace.",
            headers={"Retry-After": str(retry_after)},
        )


# ── Public client-approval pages (no login) ─────────────────────────────
# Limits come from platform settings so the super admin can tighten them
# during an attack. Like the auth limiter, they fail open if Redis is down:
# the tokens are 256-bit, so the limiter is a cost control, not the
# security boundary.
async def public_link_rate_limit(request: Request, db=Depends(get_db)) -> None:
    from app.services.platform_settings import get_setting

    try:
        per_minute = await get_setting(db, "public_approval_requests_per_minute_per_ip")
        allowed, retry_after = await _hit(f"pub:ip:{client_ip(request)}", per_minute, 60)
    except Exception:  # noqa: BLE001
        return
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a minute and try again.",
                            headers={"Retry-After": str(retry_after)})


async def public_decide_rate_limit(db, raw_token: str) -> None:
    """Per link, keyed by a short hash prefix (never the token itself)."""
    import hashlib

    from app.services.platform_settings import get_setting

    key = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()[:24]
    try:
        per_hour = await get_setting(db, "public_approval_decides_per_hour_per_link")
        allowed, retry_after = await _hit(f"pub:link:{key}", per_hour, 3600)
    except Exception:  # noqa: BLE001
        return
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many attempts on this link. Try again later.",
                            headers={"Retry-After": str(retry_after)})


INVALID_TOKEN_KEY = "pub:invalid:{hour}"


async def record_invalid_token(ip: str) -> None:
    """Count unknown tokens per IP per UTC hour, for the link-guessing alert
    (workers/tasks/approvals.py reads the hash). Never raises."""
    from datetime import datetime, timezone

    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    try:
        r = get_redis()
        key = INVALID_TOKEN_KEY.format(hour=hour)
        async with r.pipeline(transaction=True) as pipe:
            pipe.hincrby(key, ip, 1)
            pipe.expire(key, 3 * 3600)
            await pipe.execute()
    except Exception:  # noqa: BLE001
        pass
