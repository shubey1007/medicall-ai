import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.doctor import Doctor
from app.schemas.common import PaginatedResponse
from app.schemas.doctor import DoctorCreate, DoctorOut, DoctorUpdate
from app.services.qdrant_svc import upsert_doctor

router = APIRouter(prefix="/api/doctors", tags=["doctors"])


@router.get("", response_model=PaginatedResponse[DoctorOut])
async def list_doctors(
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[DoctorOut]:
    query = select(Doctor)
    count_query = select(func.count()).select_from(Doctor)

    if search:
        cond = or_(
            Doctor.name.ilike(f"%{search}%"),
            Doctor.specialization.ilike(f"%{search}%"),
        )
        query = query.where(cond)
        count_query = count_query.where(cond)

    total = (await db.execute(count_query)).scalar_one()
    query = (
        query.order_by(Doctor.name.asc().nulls_last(), Doctor.id.asc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await db.execute(query)
    doctors = result.scalars().all()

    return PaginatedResponse[DoctorOut](
        items=[DoctorOut.model_validate(d) for d in doctors],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{doctor_id}", response_model=DoctorOut)
async def get_doctor(doctor_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> DoctorOut:
    result = await db.execute(select(Doctor).where(Doctor.id == doctor_id))
    doctor = result.scalar_one_or_none()
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return DoctorOut.model_validate(doctor)


@router.post("", response_model=DoctorOut, status_code=201)
async def create_doctor(payload: DoctorCreate, db: AsyncSession = Depends(get_db)) -> DoctorOut:
    doctor = Doctor(**payload.model_dump())
    db.add(doctor)
    await db.commit()
    await db.refresh(doctor)

    # Sync doctor profile to Qdrant for semantic search
    _profile_text = (
        f"{doctor.name} is a {doctor.specialization} specialist. "
        f"Available on {', '.join(doctor.available_days or [])} from {doctor.available_hours}. "
        f"{doctor.bio or ''}"
    ).strip()
    asyncio.create_task(
        upsert_doctor(
            doctor_id=doctor.id,
            profile_text=_profile_text,
            metadata={
                "name": doctor.name,
                "specialization": doctor.specialization,
                "available_days": doctor.available_days or [],
                "available_hours": doctor.available_hours,
                "phone": doctor.phone,
                "email": doctor.email,
            },
        )
    )

    return DoctorOut.model_validate(doctor)


@router.put("/{doctor_id}", response_model=DoctorOut)
async def update_doctor(
    doctor_id: uuid.UUID,
    payload: DoctorUpdate,
    db: AsyncSession = Depends(get_db),
) -> DoctorOut:
    result = await db.execute(select(Doctor).where(Doctor.id == doctor_id))
    doctor = result.scalar_one_or_none()
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(doctor, field, value)
    await db.commit()
    await db.refresh(doctor)

    # Sync updated doctor profile to Qdrant for semantic search
    _profile_text = (
        f"{doctor.name} is a {doctor.specialization} specialist. "
        f"Available on {', '.join(doctor.available_days or [])} from {doctor.available_hours}. "
        f"{doctor.bio or ''}"
    ).strip()
    asyncio.create_task(
        upsert_doctor(
            doctor_id=doctor.id,
            profile_text=_profile_text,
            metadata={
                "name": doctor.name,
                "specialization": doctor.specialization,
                "available_days": doctor.available_days or [],
                "available_hours": doctor.available_hours,
                "phone": doctor.phone,
                "email": doctor.email,
            },
        )
    )

    return DoctorOut.model_validate(doctor)


@router.delete("/{doctor_id}", status_code=204)
async def delete_doctor(doctor_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Doctor).where(Doctor.id == doctor_id))
    doctor = result.scalar_one_or_none()
    if doctor is None:
        raise HTTPException(status_code=404, detail="Doctor not found")
    await db.delete(doctor)
    await db.commit()
