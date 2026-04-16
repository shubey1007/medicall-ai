"""Push completed call summaries to a Google Sheet. Optional — no-op without creds."""
import asyncio
import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import db_session
from app.models import Call
from app.utils.logger import get_logger, mask_phone

logger = get_logger(__name__)


HEADER_ROW = [
    "Date", "Call SID", "Patient Phone", "Duration (s)",
    "Agent Path", "Urgency", "Symptoms", "Summary", "Recommended Actions",
]


def _sync_push(creds_info: dict, spreadsheet_id: str, row: list[str]) -> None:
    """Synchronous Sheets push. Runs in a worker thread via asyncio.to_thread."""
    import gspread
    from google.oauth2.service_account import Credentials

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_info(creds_info, scopes=scopes)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(spreadsheet_id).sheet1

    if sheet.row_count == 0 or sheet.row_values(1) != HEADER_ROW:
        sheet.update("A1", [HEADER_ROW])

    sheet.append_row(row, value_input_option="USER_ENTERED")


async def push_call_summary(call_id: uuid.UUID) -> bool:
    """Push a single call's summary to the configured sheet. Returns True on success."""
    settings = get_settings()
    if not settings.google_sheets_enabled:
        logger.debug("sheets_sync_skipped", reason="not_configured")
        return False

    # Early detection of missing gspread
    try:
        import gspread  # noqa: F401
    except ImportError:
        logger.warning("sheets_sync_skipped", reason="gspread_not_installed")
        return False

    async with db_session() as db:
        result = await db.execute(
            select(Call)
            .where(Call.id == call_id)
            .options(
                selectinload(Call.patient),
                selectinload(Call.summary),
                selectinload(Call.transcript_entries),
            )
        )
        call = result.scalar_one_or_none()
        if call is None or call.summary is None:
            return False

        agents_path = "→".join(
            dict.fromkeys(
                e.agent_name for e in call.transcript_entries if e.agent_name
            )
        )

        row = [
            call.started_at.isoformat(),
            call.call_sid,
            mask_phone(call.patient.phone),
            str(call.duration_seconds or 0),
            agents_path,
            call.summary.urgency_level.value,
            ", ".join(call.summary.extracted_symptoms),
            call.summary.summary_text,
            ", ".join(call.summary.recommended_actions),
        ]

    try:
        creds_info: dict[str, Any] = json.loads(settings.google_sheets_credentials_json)
        await asyncio.to_thread(_sync_push, creds_info, settings.google_sheets_spreadsheet_id, row)
        logger.info("sheets_sync_pushed", call_id=str(call_id))
        return True
    except Exception as exc:
        logger.exception("sheets_sync_failed", error=str(exc), call_id=str(call_id))
        return False
