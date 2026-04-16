import os
from app.config import Settings


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+15555551234")
    monkeypatch.setenv("TWILIO_WEBHOOK_URL", "https://example.ngrok.app")

    s = Settings()
    assert s.database_url.startswith("postgresql+asyncpg://")
    assert s.openai_api_key == "sk-test"
    assert s.openai_realtime_model == "gpt-4o-realtime-preview"
    assert s.google_sheets_enabled is False


def test_settings_sheets_enabled_when_creds_present(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h/d")
    monkeypatch.setenv("OPENAI_API_KEY", "sk")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "t")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+1")
    monkeypatch.setenv("TWILIO_WEBHOOK_URL", "https://x")
    monkeypatch.setenv("GOOGLE_SHEETS_CREDENTIALS_JSON", '{"type":"service_account"}')
    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "sheet123")
    s = Settings()
    assert s.google_sheets_enabled is True
