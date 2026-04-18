import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.services.settings_svc import get_effective
from app.models import Call, CallStatus, CallSummary, TranscriptEntry, UrgencyLevel
from app.schemas import CallDetailOut, CallOut, PaginatedResponse, TranscriptEntryOut
from app.utils.logger import get_logger

logger = get_logger(__name__)


class InitiateCallRequest(BaseModel):
    to_phone: str


class InitiateCallResponse(BaseModel):
    call_sid: str
    to_phone: str
    status: str

router = APIRouter(prefix="/api/calls", tags=["calls"])


# Simple per-phone debounce — caches last initiate timestamp so double-clicks
# don't result in two outbound calls. 30 s window is long enough to cover a
# hasty second click, short enough that a legitimate retry after a failure
# isn't blocked forever.
_CALL_INITIATE_DEBOUNCE_SECONDS = 30
_recent_call_attempts: dict[str, datetime] = {}


@router.post("/initiate", response_model=InitiateCallResponse, status_code=202)
async def initiate_call(payload: InitiateCallRequest) -> InitiateCallResponse:
    """Place an outbound call from the Twilio number to the given phone number.
    Twilio will call the number and connect it to the AI agent pipeline.
    """
    # Debounce accidental double-submits / rapid retries for the same number
    now = datetime.now(timezone.utc)
    last = _recent_call_attempts.get(payload.to_phone)
    if last and (now - last).total_seconds() < _CALL_INITIATE_DEBOUNCE_SECONDS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"A call to {payload.to_phone} was just initiated. "
                f"Please wait {_CALL_INITIATE_DEBOUNCE_SECONDS}s before retrying."
            ),
        )
    _recent_call_attempts[payload.to_phone] = now

    base_url = get_effective('twilio_webhook_url').rstrip('/')
    twiml_url = f"{base_url}/twilio/outbound-twiml"
    status_callback_url = f"{base_url}/twilio/status-callback"
    account_sid = get_effective("twilio_account_sid")
    auth_token = get_effective("twilio_auth_token")
    from_number = get_effective("twilio_phone_number")

    def _create_twilio_call() -> str:
        from twilio.rest import Client
        client = Client(account_sid, auth_token)
        call = client.calls.create(
            to=payload.to_phone,
            from_=from_number,
            url=twiml_url,
            status_callback=status_callback_url,
            status_callback_event=["completed", "failed", "busy", "no-answer"],
            status_callback_method="POST",
        )
        return call.sid

    try:
        call_sid = await asyncio.to_thread(_create_twilio_call)
    except Exception as exc:
        logger.error("outbound_call_failed", to_phone=payload.to_phone, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc}")

    logger.info("outbound_call_initiated", call_sid=call_sid, to_phone=payload.to_phone)
    return InitiateCallResponse(call_sid=call_sid, to_phone=payload.to_phone, status="initiating")


# Calls stuck in RINGING/ACTIVE beyond this threshold are considered dead.
_STALE_CALL_MINUTES = 10


@router.get("/active", response_model=list[CallOut])
async def list_active_calls(db: AsyncSession = Depends(get_db)) -> list[CallOut]:
    """Return calls currently in RINGING or ACTIVE state.

    Any call that has been RINGING/ACTIVE for more than _STALE_CALL_MINUTES
    is auto-marked FAILED here — this is a last-resort safety net for cases
    where the Twilio/Vapi status callback was never received.
    """
    from datetime import timedelta
    from app.websocket import dashboard_ws

    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=_STALE_CALL_MINUTES)

    result = await db.execute(
        select(Call)
        .where(Call.status.in_([CallStatus.RINGING, CallStatus.ACTIVE]))
        .options(
            selectinload(Call.patient),
            selectinload(Call.summary),
        )
        .order_by(Call.started_at.desc())
    )
    calls = result.scalars().all()

    # Auto-close stale calls
    stale = [c for c in calls if c.started_at.replace(tzinfo=timezone.utc) < stale_cutoff]
    if stale:
        for c in stale:
            c.status = CallStatus.FAILED
            c.ended_at = datetime.now(timezone.utc)
        await db.commit()
        for c in stale:
            await dashboard_ws.emit_call_ended({"callSid": c.call_sid, "duration": None})
        logger.info("stale_calls_auto_closed", count=len(stale))

    # Return only genuinely active calls
    active = [c for c in calls if c not in stale]
    items: list[CallOut] = []
    for call in active:
        out = CallOut.model_validate(call)
        out.patient_name = call.patient.name if call.patient else None
        out.urgency_level = (
            call.summary.urgency_level.value.lower() if call.summary else None
        )
        items.append(out)
    return items


@router.get("", response_model=PaginatedResponse[CallOut])
async def list_calls(
    status: CallStatus | None = None,
    urgency: UrgencyLevel | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[CallOut]:
    query = select(Call)
    count_query = select(func.count()).select_from(Call)

    if status is not None:
        query = query.where(Call.status == status)
        count_query = count_query.where(Call.status == status)
    if start_date is not None:
        query = query.where(Call.started_at >= start_date)
        count_query = count_query.where(Call.started_at >= start_date)
    if end_date is not None:
        query = query.where(Call.started_at <= end_date)
        count_query = count_query.where(Call.started_at <= end_date)
    if urgency is not None:
        query = query.join(CallSummary).where(CallSummary.urgency_level == urgency)
        count_query = count_query.join(CallSummary).where(CallSummary.urgency_level == urgency)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = (
        query.options(
            selectinload(Call.patient),
            selectinload(Call.summary),
        )
        .order_by(Call.started_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await db.execute(query)
    calls = result.scalars().all()

    items = []
    for call in calls:
        out = CallOut.model_validate(call)
        out.patient_name = call.patient.name if call.patient else None
        out.urgency_level = (
            call.summary.urgency_level.value.lower() if call.summary else None
        )
        items.append(out)

    return PaginatedResponse[CallOut](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{call_id}", response_model=CallDetailOut)
async def get_call(call_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> CallDetailOut:
    result = await db.execute(
        select(Call)
        .where(Call.id == call_id)
        .options(
            selectinload(Call.transcript_entries),
            selectinload(Call.summary),
        )
    )
    call = result.scalar_one_or_none()
    if call is None:
        raise HTTPException(status_code=404, detail="Call not found")
    return CallDetailOut.model_validate(call)


@router.get("/{call_id}/transcript", response_model=list[TranscriptEntryOut])
async def get_call_transcript(
    call_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptEntryOut]:
    result = await db.execute(
        select(TranscriptEntry)
        .where(TranscriptEntry.call_id == call_id)
        .order_by(TranscriptEntry.timestamp)
    )
    entries = result.scalars().all()
    return [TranscriptEntryOut.model_validate(e) for e in entries]
