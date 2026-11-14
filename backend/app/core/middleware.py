"""Security headers + request correlation."""
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings

_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

# True while handling a request that changes something (POST, PATCH, PUT,
# DELETE). The tenancy helpers read it to refuse writes to a suspended
# workspace. False outside a request, so workers and scripts are unaffected.
request_is_write: ContextVar[bool] = ContextVar("request_is_write", default=False)
_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "0"  # rely on CSP, not the legacy filter
        # A route may set a stricter policy (the public approval pages use no-referrer).
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if not request.url.path.startswith(_DOCS_PATHS):
            response.headers["Content-Security-Policy"] = _CSP
        return response


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = request_id
        request_is_write.set(request.method not in _READ_METHODS)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
