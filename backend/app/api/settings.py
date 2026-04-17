"""Settings API — store/retrieve credential config from the database.

GET  /api/settings        → dict of all setting keys with masked values
PUT  /api/settings        → bulk upsert, refresh in-memory cache
"""
from __future__ import annotations

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.app_setting import AppSetting
from app.services import settings_svc

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Keys whose values must never leave the backend in plaintext.
_SECRET_KEYS: set[str] = {
    "openai_api_key",
    "twilio_auth_token",
    "qdrant_api_key",
    "vapi_api_key",
    "google_sheets_credentials_json",
}

# All configurable keys with their env-var fallback name (same as Settings field name).
ALL_KEYS: list[str] = [
    # OpenAI
    "openai_api_key",
    "openai_realtime_model",
    "post_call_summary_model",
    # Twilio
    "twilio_account_sid",
    "twilio_auth_token",
    "twilio_phone_number",
    "twilio_webhook_url",
    # Vapi
    "vapi_api_key",
    "vapi_phone_number_id",
    "public_url",
    # Qdrant
    "qdrant_url",
    "qdrant_api_key",
    # Notifications / Emergency
    "oncall_phone_number",
    # Clinic
    "clinic_timezone",
    # Google Sheets (optional)
    "google_sheets_credentials_json",
    "google_sheets_spreadsheet_id",
]


class SettingsPayload(BaseModel):
    settings: dict[str, str]


@router.get("")
async def get_settings_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    """Return every setting with metadata.

    - source: "db" | "env" | "unset"
    - is_set: True if there's an effective value (from DB or .env)
    - value: actual value for non-secrets; "" for secrets (never leave the backend)

    Secret fields are deliberately redacted so this endpoint is safe to expose
    on the public ngrok tunnel that Twilio/Vapi hit. The UI uses is_set + source
    to render "already configured — type to replace".
    """
    from app.config import get_settings

    result = await db.execute(select(AppSetting))
    db_rows: dict[str, str] = {row.key: row.value for row in result.scalars().all()}

    env_settings = get_settings()
    out: dict[str, dict] = {}

    for key in ALL_KEYS:
        db_val = db_rows.get(key, "")
        env_val = getattr(env_settings, key, "") or ""

        if db_val:
            source, value = "db", db_val
        elif env_val:
            source, value = "env", env_val
        else:
            source, value = "unset", ""

        is_set = bool(value)
        # Redact secrets — never expose plaintext over HTTP
        if key in _SECRET_KEYS:
            value = ""

        out[key] = {"value": value, "source": source, "is_set": is_set}

    return out


def _validate_payload(filtered: dict[str, str]) -> None:
    """Format checks. Raises HTTPException(400) on bad input."""
    # vapi_phone_number_id must be a UUID when set (Vapi API requires this)
    pid = filtered.get("vapi_phone_number_id", "").strip()
    if pid:
        try:
            _uuid.UUID(pid)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="vapi_phone_number_id must be a valid UUID (copy it from the Vapi dashboard — not a phone number).",
            )

    # URL fields — very light sanity check
    for url_key in ("twilio_webhook_url", "public_url", "qdrant_url"):
        v = filtered.get(url_key, "").strip()
        if v and not (v.startswith("http://") or v.startswith("https://")):
            raise HTTPException(
                status_code=400,
                detail=f"{url_key} must start with http:// or https://",
            )


@router.put("")
async def update_settings(
    payload: SettingsPayload,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upsert settings into the database and refresh in-memory cache.

    For secret keys: an empty string in the payload is treated as "no change"
    (so the UI can safely omit or leave the secret input blank to preserve
    the existing value). For non-secret keys, empty string clears the DB
    override and reverts to .env fallback.
    """
    # Only allow whitelisted keys
    filtered: dict[str, str] = {}
    for k, v in payload.settings.items():
        if k not in ALL_KEYS:
            continue
        # Secret + empty value → do nothing (preserve existing)
        if k in _SECRET_KEYS and not v:
            continue
        filtered[k] = v

    _validate_payload(filtered)

    if filtered:
        # PostgreSQL UPSERT
        stmt = insert(AppSetting).values(
            [{"key": k, "value": v} for k, v in filtered.items()]
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["key"],
            set_={"value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
        )
        await db.execute(stmt)
        await db.commit()

        # Refresh in-memory cache (and reconfigure dependent services)
        settings_svc.refresh(filtered)

    return {"saved": list(filtered.keys())}
