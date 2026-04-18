import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Patient
from app.schemas import PaginatedResponse, PatientCreate, PatientOut, PatientUpdate

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("", response_model=PaginatedResponse[PatientOut])
async def list_patients(
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[PatientOut]:
    query = select(Patient)
    count_query = select(func.count()).select_from(Patient)

    if search:
        cond = or_(Patient.name.ilike(f"%{search}%"), Patient.phone.ilike(f"%{search}%"))
        query = query.where(cond)
        count_query = count_query.where(cond)

    total = (await db.execute(count_query)).scalar_one()
    query = (
        query
        .order_by(Patient.name.asc().nulls_last(), Patient.id.asc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await db.execute(query)
    patients = result.scalars().all()

    return PaginatedResponse[PatientOut](
        items=[PatientOut.model_validate(p) for p in patients],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{patient_id}", response_model=PatientOut)
async def get_patient(patient_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> PatientOut:
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return PatientOut.model_validate(patient)


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(payload: PatientCreate, db: AsyncSession = Depends(get_db)) -> PatientOut:
    existing = await db.execute(select(Patient).where(Patient.phone == payload.phone))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Patient with this phone already exists")
    patient = Patient(**payload.model_dump())
    db.add(patient)
    try:
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Patient with this phone already exists")
    await db.refresh(patient)
    return PatientOut.model_validate(patient)


@router.put("/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: uuid.UUID,
    payload: PatientUpdate,
    db: AsyncSession = Depends(get_db),
) -> PatientOut:
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    updates = payload.model_dump(exclude_unset=True)

    # Phone is unique — check before assigning so we return a clean 409
    # instead of letting IntegrityError bubble up.
    new_phone = updates.get("phone")
    if new_phone is not None and new_phone != patient.phone:
        conflict = await db.execute(
            select(Patient).where(Patient.phone == new_phone, Patient.id != patient_id)
        )
        if conflict.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409, detail="Another patient already uses that phone number."
            )

    for field, value in updates.items():
        setattr(patient, field, value)

    try:
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Phone number conflict.")
    await db.refresh(patient)
    return PatientOut.model_validate(patient)


@router.delete("/{patient_id}", status_code=204)
async def delete_patient(
    patient_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    patient = (
        await db.execute(select(Patient).where(Patient.id == patient_id))
    ).scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    await db.delete(patient)
    await db.commit()
