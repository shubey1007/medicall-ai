"""Settings API — store/retrieve credential config from the database.

GET  /api/settings        → dict of all setting keys with masked values
PUT  /api/settings        → bulk upsert, refresh in-memory cache
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.app_setting import AppSetting
from app.services import settings_svc

router = APIRouter(prefix="/api/settings", tags=["settings"])

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
    # Google Sheets (optional)
    "google_sheets_credentials_json",
    "google_sheets_spreadsheet_id",
]


class SettingsPayload(BaseModel):
    settings: dict[str, str]


@router.get("")
async def get_settings_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    """Return every setting with its effective value and source (db|env|unset).

    Values are returned as-is (no masking). The dashboard is an admin UI and
    client-side password inputs provide the UX-level hiding for secrets.
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

        out[key] = {"value": value, "source": source}

    return out


@router.put("")
async def update_settings(
    payload: SettingsPayload,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upsert settings into the database and refresh in-memory cache.

    Pass empty string for a key to clear the DB override (falls back to .env).
    """
    # Only allow whitelisted keys
    filtered = {k: v for k, v in payload.settings.items() if k in ALL_KEYS}

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

        # Refresh in-memory cache
        settings_svc.refresh(filtered)

    return {"saved": list(filtered.keys())}
