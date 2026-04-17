"""Post-call SMS notifications to patients via Twilio."""
import asyncio

from twilio.rest import Client as TwilioClient

from app.models import CallSummary
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger, mask_phone

logger = get_logger(__name__)


async def send_post_call_sms(patient_phone: str, summary: CallSummary) -> bool:
    """Send a brief summary SMS to the patient. Returns True on success."""
    body_lines = [
        "MediCall summary of your call:",
        summary.summary_text,
    ]
    if summary.recommended_actions:
        body_lines.append("")
        body_lines.append("Recommended actions:")
        for action in summary.recommended_actions[:3]:
            body_lines.append(f"- {action}")
    body_lines.append("")
    body_lines.append("Call your doctor if symptoms worsen.")

    body = "\n".join(body_lines)

    try:
        client = TwilioClient(
            get_effective("twilio_account_sid"),
            get_effective("twilio_auth_token"),
        )
        await asyncio.to_thread(
            client.messages.create,
            body=body[:1600],
            from_=get_effective("twilio_phone_number"),
            to=patient_phone,
        )
        logger.info("post_call_sms_sent", to=mask_phone(patient_phone))
        return True
    except Exception as exc:
        logger.exception("post_call_sms_failed", error=str(exc), to=mask_phone(patient_phone))
        return False
