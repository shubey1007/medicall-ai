from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str

    # Twilio
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_phone_number: str
    twilio_webhook_url: str

    # OpenAI
    openai_api_key: str
    openai_realtime_model: str = "gpt-4o-realtime-preview"
    post_call_summary_model: str = "gpt-4o-mini"

    # Emergency
    oncall_phone_number: str = ""

    # Clinic — IANA timezone name (e.g. America/New_York, Asia/Kolkata).
    # Used to render scheduled_at in human-readable form for patient-facing
    # communications (Vapi reminder calls, SMS).
    clinic_timezone: str = "Asia/Kolkata"

    # Security
    # If True, Twilio webhook signature validation is skipped. Only enable this
    # temporarily for local testing without real Twilio. In production/staging
    # this MUST be False.
    twilio_skip_signature_validation: bool = False

    # Dashboard auth — single shared password + JWT secret for signing tokens.
    # Bootstrap-only (NOT exposed in Settings UI to avoid the "lock yourself
    # out" / circular config problem). Set both in .env before first run.
    # If dashboard_password is empty, login will be rejected by the API.
    dashboard_password: str = ""
    jwt_secret: str = "change-me-in-env-please"
    jwt_ttl_hours: int = 24

    # Dashboard auth — shared bearer token required for /api/* (except public
    # webhooks) and the Socket.IO dashboard namespace. Leave empty to disable
    # auth entirely (clean-checkout friendly). When set, the dashboard shows a
    # login page and clients must present Authorization: Bearer <token>.
    dashboard_api_token: str = ""

    # Google Sheets (optional)
    google_sheets_credentials_json: str = ""
    google_sheets_spreadsheet_id: str = ""

    # Qdrant
    qdrant_url: str = ""
    qdrant_api_key: str = ""

    # Vapi
    vapi_api_key: str = ""
    vapi_phone_number_id: str = ""  # Vapi phone number UUID for outbound calls
    public_url: str = "https://your-ngrok-url.ngrok.io"

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    environment: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"

    @property
    def google_sheets_enabled(self) -> bool:
        return bool(self.google_sheets_credentials_json and self.google_sheets_spreadsheet_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
