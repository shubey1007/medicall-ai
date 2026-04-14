import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import get_db
from app.models import Appointment, AppointmentStatus
from app.schemas import (
    AppointmentCreate,
    AppointmentOut,
    AppointmentUpdate,
    PaginatedResponse,
)

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


@router.get("", response_model=PaginatedResponse[AppointmentOut])
async def list_appointments(
    patient_id: uuid.UUID | None = None,
    status: AppointmentStatus | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[AppointmentOut]:
    query = select(Appointment)
    count_query = select(func.count()).select_from(Appointment)

    if patient_id:
        query = query.where(Appointment.patient_id == patient_id)
        count_query = count_query.where(Appointment.patient_id == patient_id)
    if status:
        query = query.where(Appointment.status == status)
        count_query = count_query.where(Appointment.status == status)

    total = (await db.execute(count_query)).scalar_one()
    query = (
        query.order_by(Appointment.scheduled_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await db.execute(query)
    items = result.scalars().all()

    return PaginatedResponse[AppointmentOut](
        items=[AppointmentOut.model_validate(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=AppointmentOut, status_code=201)
async def create_appointment(
    payload: AppointmentCreate,
    db: AsyncSession = Depends(get_db),
) -> AppointmentOut:
    appt = Appointment(**payload.model_dump(), status=AppointmentStatus.PENDING)
    db.add(appt)
    await db.flush()
    await db.commit()
    await db.refresh(appt)
    return AppointmentOut.model_validate(appt)


@router.put("/{appointment_id}", response_model=AppointmentOut)
async def update_appointment(
    appointment_id: uuid.UUID,
    payload: AppointmentUpdate,
    db: AsyncSession = Depends(get_db),
) -> AppointmentOut:
    result = await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    appt = result.scalar_one_or_none()
    if appt is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(appt, field, value)
    await db.flush()
    await db.commit()
    await db.refresh(appt)
    return AppointmentOut.model_validate(appt)


@router.delete("/{appointment_id}", status_code=204)
async def cancel_appointment(
    appointment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    appt = result.scalar_one_or_none()
    if appt is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appt.status = AppointmentStatus.CANCELLED
    await db.flush()
    await db.commit()


@router.post("/{appointment_id}/remind", status_code=200)
async def send_appointment_reminder(
    appointment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Trigger a Vapi outbound call to remind patient about appointment."""
    result = await db.execute(
        select(Appointment)
        .options(selectinload(Appointment.patient))
        .where(Appointment.id == appointment_id)
    )
    appt = result.scalar_one_or_none()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    settings = get_settings()
    if not settings.vapi_api_key:
        return {"status": "skipped", "reason": "Vapi not configured"}

    patient_phone = appt.patient.phone if appt.patient else None
    if not patient_phone:
        return {"status": "skipped", "reason": "No patient phone number"}

    scheduled = appt.scheduled_at.strftime("%A, %B %d at %I:%M %p")

    payload = {
        "phoneNumberId": settings.vapi_phone_number_id,
        "customer": {"number": patient_phone},
        "assistant": {
            "name": "MediCall Reminder",
            "model": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "systemPrompt": (
                    f"You are a medical reminder assistant calling to remind a patient "
                    f"about their appointment with {appt.doctor_name} on {scheduled}. "
                    "Be brief and friendly. Ask if they can confirm attendance. "
                    "If they want to reschedule, note it and end the call. "
                    "Always respond in English."
                ),
                "temperature": 0.5,
            },
            "voice": {"provider": "playht", "voiceId": "jennifer"},
            "firstMessage": (
                f"Hello! This is MediCall AI calling to remind you about your appointment "
                f"with {appt.doctor_name} on {scheduled}. Can you confirm you'll be attending?"
            ),
            "endCallFunctionEnabled": True,
        },
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://api.vapi.ai/call/phone",
                headers={
                    "Authorization": f"Bearer {settings.vapi_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return {"status": "reminder_sent", "vapi_call_id": data.get("id")}
        except httpx.HTTPStatusError as exc:
            return {"status": "error", "reason": f"Vapi API error: {exc.response.status_code}"}
        except httpx.TimeoutException:
            return {"status": "error", "reason": "Vapi API timeout"}
