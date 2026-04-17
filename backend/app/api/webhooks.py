"""Twilio incoming call webhook — creates Call record and returns TwiML."""
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, VoiceResponse

from app.config import get_settings
from app.database import get_db
from app.models import Call, CallStatus, Patient
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger, mask_phone

logger = get_logger(__name__)
router = APIRouter(tags=["twilio"])


async def _validate_twilio_signature(request: Request) -> None:
    """Verify the X-Twilio-Signature header on inbound Twilio webhooks.

    Always validates when a Twilio auth token is configured. The previous
    behaviour — bypassing validation in any non-production env — left the
    webhook publicly spoofable on the ngrok tunnel we use for local dev,
    so anyone could forge /twilio/incoming requests and burn our OpenAI
    and Twilio credits. To bypass intentionally (e.g. testing with no real
    Twilio at all), set TWILIO_SKIP_SIGNATURE_VALIDATION=true in .env.
    """
    settings = get_settings()
    if settings.twilio_skip_signature_validation:
        logger.warning("twilio_signature_validation_skipped_via_flag")
        return

    auth_token = get_effective("twilio_auth_token")
    if not auth_token:
        # No token configured at all — can't validate; reject so a forgotten
        # configuration doesn't silently open a spoofing hole.
        raise HTTPException(
            status_code=503,
            detail="Twilio auth token not configured; cannot validate webhook",
        )

    signature = request.headers.get("X-Twilio-Signature", "")
    form = await request.form()

    base = get_effective("twilio_webhook_url").rstrip("/")
    url = f"{base}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    validator = RequestValidator(auth_token)
    if not validator.validate(url, dict(form), signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


@router.post("/twilio/incoming")
async def twilio_incoming(
    request: Request,
    CallSid: str = Form(...),
    From: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _validate_twilio_signature(request)

    # Find or create patient
    result = await db.execute(select(Patient).where(Patient.phone == From))
    patient = result.scalar_one_or_none()
    if not patient:
        patient = Patient(phone=From, medical_context={})
        db.add(patient)
        await db.flush()

    # Create call record
    call = Call(
        call_sid=CallSid,
        patient_id=patient.id,
        status=CallStatus.RINGING,
        current_agent="triage",
    )
    db.add(call)
    await db.flush()
    await db.commit()

    logger.info(
        "twilio_incoming",
        call_sid=CallSid,
        patient_phone=mask_phone(From),
        db_call_id=str(call.id),
    )

    # Build TwiML with Stream to our WS endpoint
    host = urlparse(get_effective("twilio_webhook_url")).netloc
    ws_url = f"wss://{host}/media-stream"

    response = VoiceResponse()
    response.say("Connecting you to MediCall AI.", voice="alice")
    connect = Connect()
    stream = connect.stream(url=ws_url)
    stream.parameter(name="callSid", value=CallSid)
    stream.parameter(name="patientPhone", value=From)
    stream.parameter(name="dbCallId", value=str(call.id))
    stream.parameter(name="patientId", value=str(patient.id))
    response.append(connect)

    return Response(content=str(response), media_type="application/xml")


@router.post("/twilio/outbound-twiml")
async def twilio_outbound_twiml(
    request: Request,
    CallSid: str = Form(...),
    To: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Twilio hits this URL when an outbound call is answered.
    'To' is the patient's number (the number we dialled).
    """
    # Find or create patient by the number we called
    result = await db.execute(select(Patient).where(Patient.phone == To))
    patient = result.scalar_one_or_none()
    if not patient:
        patient = Patient(phone=To, medical_context={})
        db.add(patient)
        await db.flush()

    call = Call(
        call_sid=CallSid,
        patient_id=patient.id,
        status=CallStatus.RINGING,
        current_agent="triage",
    )
    db.add(call)
    await db.flush()
    await db.commit()

    logger.info(
        "twilio_outbound_twiml",
        call_sid=CallSid,
        patient_phone=mask_phone(To),
        db_call_id=str(call.id),
    )

    host = urlparse(get_effective("twilio_webhook_url")).netloc
    ws_url = f"wss://{host}/media-stream"

    response = VoiceResponse()
    response.say("Connecting you to MediCall AI.", voice="alice")
    connect = Connect()
    stream = connect.stream(url=ws_url)
    stream.parameter(name="callSid", value=CallSid)
    stream.parameter(name="patientPhone", value=To)
    stream.parameter(name="dbCallId", value=str(call.id))
    stream.parameter(name="patientId", value=str(patient.id))
    response.append(connect)

    return Response(content=str(response), media_type="application/xml")
