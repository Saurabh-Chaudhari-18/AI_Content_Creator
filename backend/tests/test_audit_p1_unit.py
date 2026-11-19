"""Unit tests for the audit's P1 fixes that need no database."""
import httpx
import pytest

from app.core.exceptions import PermanentPublishError, RetryablePublishError, UnknownOutcomePublishError


def _fake_platform(monkeypatch, module, status_code: int, body):
    """Every HTTP call the adapter makes gets this response."""
    def handler(request: httpx.Request) -> httpx.Response:
        if isinstance(body, str):
            return httpx.Response(status_code, text=body)
        return httpx.Response(status_code, json=body)

    real_client = httpx.Client
    monkeypatch.setattr(module.httpx, "Client",
                        lambda *a, **kw: real_client(transport=httpx.MockTransport(handler)))


def _publish_facebook():
    from app.services.publishing.facebook import FacebookAdapter

    return FacebookAdapter().publish(caption="Hello", media_urls=[], access_token="EAA-real-looking",
                                     account_metadata={"page_id": "123"})


# ── BIZ-03: a server error on the call that creates the post ──────────
@pytest.mark.parametrize("status_code, body", [
    (500, {"error": {"code": 1, "message": "An unknown error occurred"}}),
    (503, {"error": {"code": 2, "message": "Service temporarily unavailable"}}),
    (502, "<html>Bad Gateway</html>"),
])
def test_facebook_server_error_after_posting_is_an_unknown_outcome(monkeypatch, status_code, body):
    from app.services.publishing import facebook

    _fake_platform(monkeypatch, facebook, status_code, body)
    with pytest.raises(UnknownOutcomePublishError):
        _publish_facebook()


def test_facebook_rate_limit_is_still_retried(monkeypatch):
    from app.services.publishing import facebook

    _fake_platform(monkeypatch, facebook, 400, {"error": {"code": 4, "message": "Application request limit"}})
    with pytest.raises(RetryablePublishError):
        _publish_facebook()


def test_facebook_auth_error_is_still_permanent(monkeypatch):
    from app.services.publishing import facebook

    _fake_platform(monkeypatch, facebook, 400, {"error": {"code": 190, "message": "Token expired"}})
    with pytest.raises(PermanentPublishError):
        _publish_facebook()


def test_a_server_error_before_the_final_call_is_still_retried():
    """Instagram's container step creates nothing public: safe to retry."""
    from app.services.publishing.facebook import _classify_meta_error

    with pytest.raises(RetryablePublishError):
        _classify_meta_error(500, {"code": 1}, "Instagram container")


def test_linkedin_server_error_after_posting_is_an_unknown_outcome(monkeypatch):
    from app.services.publishing import linkedin

    _fake_platform(monkeypatch, linkedin, 500, {"message": "Internal error"})
    with pytest.raises(UnknownOutcomePublishError):
        linkedin.LinkedInAdapter().publish(caption="Hello", media_urls=[], access_token="real-token",
                                           account_metadata={"platform_account_id": "abc"})
