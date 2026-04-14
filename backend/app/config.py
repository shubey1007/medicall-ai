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
