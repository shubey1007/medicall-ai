"""Auth endpoints for the dashboard.

GET  /api/auth/status   → public; reports auth mode (none | password | static)
POST /api/auth/login    → exchanges a password for a JWT
GET  /api/auth/me       → protected; returns 200 if the bearer token is valid
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import (
    auth_enabled,
    check_password,
    create_token,
    require_auth,
    _jwt_enabled,
    _password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_in_hours: int


@router.get("/status")
async def auth_status() -> dict:
    """Public: tells the dashboard whether to render the login screen."""
    if not auth_enabled():
        return {"auth_required": False, "mode": "none"}
    if _jwt_enabled():
        return {"auth_required": True, "mode": "password"}
    # Static-token only — dashboard must use a manually-configured token
    return {"auth_required": True, "mode": "static"}


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    """Exchange the dashboard password for a signed JWT."""
    if not _password():
        raise HTTPException(
            status_code=503,
            detail="Password login is not configured. Set DASHBOARD_PASSWORD in .env.",
        )
    if not check_password(payload.password):
        raise HTTPException(status_code=401, detail="Incorrect password")

    from app.config import get_settings
    return LoginResponse(
        token=create_token(),
        expires_in_hours=get_settings().jwt_ttl_hours,
    )


@router.get("/me", dependencies=[Depends(require_auth)])
async def me() -> dict:
    """Protected: returns 200 + identity if the bearer token is valid."""
    return {"ok": True, "subject": "dashboard-admin"}
