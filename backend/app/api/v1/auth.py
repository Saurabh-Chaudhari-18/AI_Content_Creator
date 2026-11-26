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
from app.core.rate_limit import _hit as rate_hit
from app.models import AuditAction, RefreshToken, SetupTokenPurpose, User, UserSetupToken
from app.schemas.schemas import (
    AccessTokenResponse, AuthResponse, ForgotPasswordRequest, LoginRequest, MessageResponse,
    RegisterRequest, SetPasswordRequest, UserPreferencesUpdate, UserResponse,
)
from app.services import accounts
from app.services import email as mailer
from app.services.audit import record_audit_event
from app.services.accounts import create_workspace, hash_setup_token
from app.services.platform_settings import get_setting

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


FORGOT_SENT = "If that email has an account, we've sent a link to reset the password. It may take a minute."


@router.post("/forgot-password", response_model=MessageResponse, dependencies=[Depends(auth_rate_limit)])
async def forgot_password(req: ForgotPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Email a one-time "set a new password" link. The answer is the same
    whether or not the address has an account, so nobody can use this to
    find out who is a customer. Limited per IP (the dependency) and to a few
    emails per address per hour, so it can't be used to flood an inbox."""
    if not settings.email_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset by email isn't set up yet. Ask your workspace owner or our support team.",
        )
    email = req.email.lower()
    try:
        allowed, _retry = await rate_hit(f"forgot:{email}", 3, 3600)
    except Exception:  # noqa: BLE001 — Redis down: the per-IP limit still applies
        allowed = True
    user = await db.scalar(select(User).where(User.email == email))
    if allowed and user is not None and user.is_active:
        link, _expires = await accounts.issue_setup_link(
            db, user_id=user.id, purpose=SetupTokenPurpose.PASSWORD_RESET, created_by_user_id=None)
        to = mailer.Recipient(user.email, user.full_name)
        subject, text = mailer.password_reset_email(to=to, link=link,
                                                    hours=await get_setting(db, "setup_link_hours"))
        mailer.queue(db, kind="password_reset", to=to, subject=subject, text=text)
        record_audit_event(
            db, action=AuditAction.SETUP_LINK, entity_type="User", entity_id=user.id,
            workspace_id=None, user_id=user.id, user_email=user.email, user_name=user.full_name,
            changes={"after": {"purpose": "password_reset", "requested_by": "the user, by email"}},
            ip_address=client_ip(request),
        )
        await db.commit()
        mailer.kick()
    return MessageResponse(message=FORGOT_SENT)


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
    """Update the caller's own preferences (theme, approval emails). Only ever
    touches the authenticated user's row — there is no user id in the path to
    tamper with."""
    def plain(value):
        return getattr(value, "value", value)

    changes = data.model_dump(exclude_unset=True)
    before = {k: plain(getattr(current_user, k)) for k in changes}
    for field, value in changes.items():
        setattr(current_user, field, value)
    after = {k: plain(v) for k, v in changes.items()}
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
