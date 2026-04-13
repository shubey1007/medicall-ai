import asyncio
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_db
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


@router.post("/initiate", response_model=InitiateCallResponse, status_code=202)
async def initiate_call(payload: InitiateCallRequest) -> InitiateCallResponse:
    """Place an outbound call from the Twilio number to the given phone number.
    Twilio will call the number and connect it to the AI agent pipeline.
    """
    settings = get_settings()
    twiml_url = f"{settings.twilio_webhook_url.rstrip('/')}/twilio/outbound-twiml"

    def _create_twilio_call() -> str:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        call = client.calls.create(
            to=payload.to_phone,
            from_=settings.twilio_phone_number,
            url=twiml_url,
        )
        return call.sid

    try:
        call_sid = await asyncio.to_thread(_create_twilio_call)
    except Exception as exc:
        logger.error("outbound_call_failed", to_phone=payload.to_phone, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Twilio error: {exc}")

    logger.info("outbound_call_initiated", call_sid=call_sid, to_phone=payload.to_phone)
    return InitiateCallResponse(call_sid=call_sid, to_phone=payload.to_phone, status="initiating")


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
