"""Dashboard auth — password login + JWT bearer tokens.

Two modes are supported via .env:

  DASHBOARD_PASSWORD + JWT_SECRET → user-facing login screen issues a JWT
  DASHBOARD_API_TOKEN             → static bearer token (scripting / legacy)

Either or both may be configured. Bearer requests are accepted if they
match a valid JWT *or* the static token. If neither is set, auth is
disabled entirely so a clean checkout still works.

Webhooks (Twilio / Vapi) are NOT protected by this — they have their
own provider-side signature validation.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException, status

from app.config import get_settings

JWT_ALGORITHM = "HS256"
JWT_SUBJECT = "dashboard-admin"
_PLACEHOLDER_SECRET = "change-me-in-env-please"


# ─── helpers ─────────────────────────────────────────────────────────────────


def _password() -> str:
    return get_settings().dashboard_password.strip()


def _static_token() -> str:
    return get_settings().dashboard_api_token.strip()


def _jwt_secret() -> str:
    return get_settings().jwt_secret.strip()


def _jwt_enabled() -> bool:
    return bool(_password()) and bool(_jwt_secret()) and _jwt_secret() != _PLACEHOLDER_SECRET


def auth_enabled() -> bool:
    """True when any auth mechanism is configured."""
    return bool(_password()) or bool(_static_token())


# ─── token operations ────────────────────────────────────────────────────────


def create_token() -> str:
    """Issue a JWT for an authenticated dashboard session.

    Caller is responsible for verifying the password before invoking this.
    """
    if not _jwt_enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "Login disabled: set DASHBOARD_PASSWORD and a non-default "
                "JWT_SECRET in .env to enable password login."
            ),
        )
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": JWT_SUBJECT,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_ttl_hours)).timestamp()),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def _verify_jwt(token: str) -> bool:
    """Return True if `token` is a valid JWT issued by us."""
    if not _jwt_enabled():
        return False
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return False
    return payload.get("sub") == JWT_SUBJECT


def _verify_static(token: str) -> bool:
    """Constant-time compare against the configured static API token."""
    expected = _static_token()
    if not expected:
        return False
    return secrets.compare_digest(token, expected)


def check_password(submitted: str) -> bool:
    """Constant-time check against the configured dashboard password."""
    expected = _password()
    if not expected:
        return False
    return secrets.compare_digest(submitted, expected)


# ─── FastAPI dependency ──────────────────────────────────────────────────────


async def require_auth(authorization: str | None = Header(default=None)) -> None:
    """Dependency: 401 unless the request carries a valid bearer token.

    Silently permits all requests when no auth is configured at all
    (clean-checkout friendliness). When auth IS configured, accepts either:
      - a JWT issued via POST /api/auth/login, or
      - the static DASHBOARD_API_TOKEN.
    """
    if not auth_enabled():
        return

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expected Authorization: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if _verify_jwt(token) or _verify_static(token):
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_token_value(token: str) -> bool:
    """Pure check (no Header magic) for use outside HTTP request handlers
    (e.g. Socket.IO connect handler).
    """
    if not auth_enabled():
        return True
    return _verify_jwt(token) or _verify_static(token)
