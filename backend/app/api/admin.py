"""Admin / operator endpoints — mostly for diagnostics.

Protected by the normal bearer-token guard via main.py's router-level dependency.
"""
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.doctor import Doctor
from app.services import qdrant_svc
from app.services.qdrant_svc import COLLECTIONS, get_client, upsert_doctor
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = get_logger(__name__)


def _doctor_profile_text(doctor: Doctor) -> str:
    return (
        f"{doctor.name} is a {doctor.specialization} specialist. "
        f"Available on {', '.join(doctor.available_days or [])} from {doctor.available_hours}. "
        f"{doctor.bio or ''}"
    ).strip()


@router.get("/qdrant/stats")
async def qdrant_stats() -> dict[str, Any]:
    """Return point counts per collection.

    Surfaces Qdrant health on the Analytics page so you can see memory
    grow call-by-call (or spot when it's silently broken).
    """
    configured = bool(get_effective("qdrant_url"))
    if not configured:
        return {"available": False, "reason": "QDRANT_URL not configured", "collections": {}}
    if not qdrant_svc._qdrant_available:
        return {"available": False, "reason": "Qdrant startup check failed", "collections": {}}

    client = get_client()
    out: dict[str, int | None] = {}
    for name in COLLECTIONS:
        try:
            info = await client.count(collection_name=name, exact=True)
            out[name] = int(info.count)
        except Exception as exc:
            logger.warning("qdrant_count_failed", collection=name, error=str(exc))
            out[name] = None
    return {"available": True, "collections": out}


@router.post("/qdrant/backfill-doctors")
async def backfill_doctors(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Upsert every active doctor into the doctor_directory collection.

    Idempotent — safe to run repeatedly. Useful after seeding the DB outside
    the normal create-doctor flow or after a Qdrant cluster reset.
    """
    if not qdrant_svc._qdrant_available:
        return {"status": "skipped", "reason": "qdrant_unavailable", "synced": 0}

    result = await db.execute(select(Doctor).where(Doctor.is_active.is_(True)))
    doctors = result.scalars().all()

    synced = 0
    for doctor in doctors:
        try:
            await upsert_doctor(
                doctor_id=doctor.id,
                profile_text=_doctor_profile_text(doctor),
                metadata={
                    "name": doctor.name,
                    "specialization": doctor.specialization,
                    "available_days": doctor.available_days or [],
                    "available_hours": doctor.available_hours,
                    "phone": doctor.phone,
                    "email": doctor.email,
                },
            )
            synced += 1
        except Exception as exc:
            logger.warning("backfill_doctor_failed", doctor_id=str(doctor.id), error=str(exc))

    logger.info("doctor_backfill_complete", synced=synced, total=len(doctors))
    return {"status": "ok", "synced": synced, "total": len(doctors)}
