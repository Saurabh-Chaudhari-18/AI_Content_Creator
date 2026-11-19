"""Regression tests for the 2026-11-18 audit's P0 fixes that need no database
(docs/audit/2026-11-18-product-audit.md)."""
import asyncio

import httpx

from app.core.security import hash_password, verify_password_async


def test_password_check_does_not_block_the_event_loop():
    """PERF-01: bcrypt (~250 ms) used to run on the event loop, freezing every
    other request while anyone logged in. The loop must keep ticking now."""
    stored = hash_password("correct horse battery staple")

    async def main() -> tuple[bool, int]:
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                ticks += 1
                await asyncio.sleep(0.005)

        task = asyncio.create_task(ticker())
        await asyncio.sleep(0)
        ok = await verify_password_async("correct horse battery staple", stored)
        task.cancel()
        return ok, ticks

    ok, ticks = asyncio.run(main())
    assert ok is True
    assert ticks >= 5, f"event loop stalled during bcrypt ({ticks} ticks)"


def test_unknown_account_still_costs_a_bcrypt_check():
    """SEC-07: "no such email" must not answer measurably faster than a wrong password."""
    import time

    stored = hash_password("some password")
    t0 = time.perf_counter()
    assert asyncio.run(verify_password_async("guess", None)) is False
    no_user = time.perf_counter() - t0
    t0 = time.perf_counter()
    assert asyncio.run(verify_password_async("guess", stored)) is False
    wrong_pw = time.perf_counter() - t0
    assert no_user > wrong_pw * 0.5


def test_meta_error_description_never_contains_the_url_secret():
    """SEC-04: the token-exchange URL carries client_secret and the OAuth code."""
    from app.services.meta_oauth import describe_error

    request = httpx.Request(
        "GET", "https://graph.facebook.com/v21.0/oauth/access_token"
               "?client_id=1&client_secret=TOP-SECRET-VALUE&code=ONE-TIME-CODE",
    )
    response = httpx.Response(400, request=request,
                              json={"error": {"code": 100, "type": "OAuthException", "message": "Invalid code"}})
    exc = httpx.HTTPStatusError("boom", request=request, response=response)
    # The raw exception text DOES carry the secret — which is why it is never logged.
    assert "TOP-SECRET-VALUE" in str(httpx.HTTPStatusError(
        f"Client error for url '{request.url}'", request=request, response=response))
    text = describe_error(exc)
    assert "TOP-SECRET-VALUE" not in text and "ONE-TIME-CODE" not in text
    assert "400" in text and "100" in text and "OAuthException" in text

    timeout = httpx.ConnectTimeout("timed out", request=request)
    assert "TOP-SECRET-VALUE" not in describe_error(timeout)


def test_brand_guidelines_drop_server_owned_keys():
    """SEC-03: a client must never set `_logo_storage_key` (the logo upload deletes it)."""
    from pydantic import ValidationError

    from app.schemas.schemas import BrandCreate, BrandUpdate

    update = BrandUpdate(brand_guidelines={"palette": ["#111111"], "_logo_storage_key": "media/victim.jpg"})
    assert update.brand_guidelines == {"palette": ["#111111"]}
    create = BrandCreate(name="B", brand_guidelines={"_anything": 1, "tone": "warm"})
    assert create.brand_guidelines == {"tone": "warm"}
    try:
        BrandUpdate(brand_guidelines={"notes": "x" * 30_000})
    except ValidationError:
        pass
    else:
        raise AssertionError("oversized brand_guidelines must be rejected")
