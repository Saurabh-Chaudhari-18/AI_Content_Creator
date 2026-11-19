"""Authentication.

Access token: short-lived JWT, returned in the body, held in SPA memory.
Refresh token: opaque random value in an HttpOnly, SameSite=strict cookie —
never in a response body, never readable by JavaScript. Rotated on every
refresh; the DB stores only its SHA-256 hash.
CSRF: double-submit cookie protects the cookie-authenticated endpoints
(/refresh, /logout).
"""
import hmac as hmac_mod
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.dependencies import client_ip, get_current_user
from app.core.rate_limit import auth_rate_limit
from app.core.security import (
    create_access_token,
    generate_csrf_token,
    generate_refresh_token,
    hash_password_async,
    hash_refresh_token,
    verify_password_async,
)
from app.db.session import get_db
from app.models import AuditAction, RefreshToken, User, UserSetupToken
from app.schemas.schemas import (
    AccessTokenResponse, AuthResponse, LoginRequest, MessageResponse,
    RegisterRequest, SetPasswordRequest, UserPreferencesUpdate, UserResponse,
)
from app.services.audit import record_audit_event
from app.services.accounts import create_workspace, hash_setup_token

router = APIRouter(prefix="/auth", tags=["Authentication"])



def _set_auth_cookies(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,                      # JavaScript cannot read it
        secure=settings.COOKIE_SECURE,      # HTTPS-only outside local dev
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path=settings.REFRESH_COOKIE_PATH,  # only sent to /api/v1/auth/*
    )
    # Readable CSRF cookie: the SPA copies it into the X-CSRF-Token header.
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=generate_csrf_token(),
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH)
    response.delete_cookie(settings.CSRF_COOKIE_NAME, path="/")


def _require_csrf(request: Request) -> None:
    cookie_token = request.cookies.get(settings.CSRF_COOKIE_NAME)
    header_token = request.headers.get(settings.CSRF_HEADER_NAME)
    if not cookie_token or not header_token or not hmac_mod.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")


def _new_refresh_record(request: Request, user_id) -> tuple[str, RefreshToken]:
    raw = generate_refresh_token()
    record = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        is_revoked=False,
        ip_address=client_ip(request),
        user_agent=(request.headers.get("User-Agent") or "")[:1000] or None,
    )
    return raw, record


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(auth_rate_limit)])
async def register(req: RegisterRequest, request: Request, response: Response,
                   db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(User).where(User.email == req.email.lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="A user with this email already exists.")

    user = User(
        email=req.email.lower(),
        password_hash=await hash_password_async(req.password),
        full_name=req.full_name,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await create_workspace(db, owner_id=user.id, name=f"{req.full_name.strip()}'s Workspace")

    raw_refresh, record = _new_refresh_record(request, user.id)
    db.add(record)
    await db.commit()
    await db.refresh(user)

    _set_auth_cookies(response, raw_refresh)
    return AuthResponse(user=UserResponse.model_validate(user),
                        access_token=create_access_token(str(user.id)))


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(auth_rate_limit)])
async def login(req: LoginRequest, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == req.email.lower()))

    if not await verify_password_async(req.password, user.password_hash if user else None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is inactive.")

    raw_refresh, record = _new_refresh_record(request, user.id)
    db.add(record)
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    _set_auth_cookies(response, raw_refresh)
    return AuthResponse(user=UserResponse.model_validate(user),
                        access_token=create_access_token(str(user.id)))


@router.post("/set-password", response_model=MessageResponse, dependencies=[Depends(auth_rate_limit)])
async def set_password(req: SetPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Redeem a one-time link from the admin panel: a new login chooses its
    password, or an existing one replaces a forgotten password. The link is
    the proof of identity, so every failure gets the same answer."""
    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This link is invalid or has expired. Ask for a new one.")
    now = datetime.now(timezone.utc)
    token = await db.scalar(
        select(UserSetupToken)
        .where(UserSetupToken.token_hash == hash_setup_token(req.token))
        .with_for_update()  # two requests with the same link: only one wins
    )
    if token is None or token.used_at is not None or token.expires_at <= now:
        raise invalid
    user = await db.scalar(select(User).where(User.id == token.user_id))
    if user is None or not user.is_active:
        raise invalid

    user.password_hash = await hash_password_async(req.password)
    token.used_at = now
    # Whoever knew the old password, or held a session, is signed out.
    await db.execute(
        update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.is_revoked == False)  # noqa: E712
        .values(is_revoked=True)
    )
    record_audit_event(
        db, action=AuditAction.UPDATE, entity_type="User", entity_id=user.id,
        workspace_id=None, user_id=user.id, user_email=user.email, user_name=user.full_name,
        changes={"after": {"password": "set from a setup link", "purpose": token.purpose.value}},
        ip_address=client_ip(request),
    )
    await db.commit()
    return MessageResponse(message="Password saved. You can sign in now.")


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh_access_token(request: Request, response: Response,
                               db: AsyncSession = Depends(get_db)):
    _require_csrf(request)

    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    # ROTATION: consume the old token, issue a new one. A stolen refresh
    # token dies the moment the legitimate client rotates.
    # Consumed in ONE statement: two requests with the same cookie (two tabs
    # waking up together) can't both pass a check and both mint a session —
    # the second UPDATE waits for the first and then matches nothing.
    user_id = await db.scalar(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(raw),
            RefreshToken.is_revoked == False,  # noqa: E712
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
        .values(is_revoked=True)
        .returning(RefreshToken.user_id)
    )
    if user_id is None:
        # No cookie deletion here: when another tab has just rotated this
        # token, the browser already holds that tab's NEW cookie, and
        # deleting the cookies would sign every tab out.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked or expired")

    # The account must still be active — a deactivated user must not keep
    # minting fresh access tokens from an old refresh token.
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user or not user.is_active:
        await db.commit()  # keep the token consumed
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive")

    raw_new, new_record = _new_refresh_record(request, user.id)
    db.add(new_record)
    await db.commit()

    _set_auth_cookies(response, raw_new)
    return AccessTokenResponse(access_token=create_access_token(str(user.id)))


@router.post("/logout", response_model=MessageResponse)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    # Deliberately requires only the cookie (not a live access token), so an
    # expired session can still log out. CSRF-protected like /refresh.
    _require_csrf(request)

    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if raw:
        record = await db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
        )
        if record:
            record.is_revoked = True
            await db.commit()

    _clear_auth_cookies(response)
    return MessageResponse(message="Successfully logged out.")


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_my_preferences(
    data: UserPreferencesUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the caller's own preferences (theme). Only ever touches the
    authenticated user's row — there is no user id in the path to tamper with."""
    changes = data.model_dump(exclude_unset=True)
    before = {k: getattr(current_user, k).value for k in changes}
    for field, value in changes.items():
        setattr(current_user, field, value)
    after = {k: v.value for k, v in changes.items()}
    if before != after:
        record_audit_event(
            db, action=AuditAction.UPDATE, entity_type="User", entity_id=current_user.id,
            workspace_id=None, user_id=current_user.id, user_email=current_user.email,
            user_name=current_user.full_name, changes={"before": before, "after": after},
            ip_address=client_ip(request), user_agent=request.headers.get("user-agent"),
        )
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)
