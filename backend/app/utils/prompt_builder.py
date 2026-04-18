"""Build enriched system prompts using Qdrant + DB context."""
import uuid

from sqlalchemy import select

from app.database import db_session
from app.models.doctor import Doctor
from app.services.qdrant_svc import search_patient_memory


async def build_patient_context(patient_id: uuid.UUID | None, query: str = "patient history") -> str:
    """Return a formatted memory block for injection into system prompts."""
    if not patient_id:
        return ""
    memories = await search_patient_memory(patient_id, query, limit=5)
    if not memories:
        return ""
    lines = ["[Patient Memory from previous calls:]"]
    for m in memories:
        lines.append(f"- {m['text']}")
    return "\n".join(lines)


async def build_clinic_context() -> str:
    """Return the canonical list of active doctors so the LLM proposes real
    names. Without this, the agent makes up names from the static prompt and
    appointments never map to the Doctor table.
    """
    try:
        async with db_session() as db:
            result = await db.execute(
                select(Doctor)
                .where(Doctor.is_active.is_(True))
                .order_by(Doctor.name.asc())
            )
            doctors = result.scalars().all()
    except Exception:
        # Never break a call because we couldn't load the roster
        return ""

    if not doctors:
        return ""

    lines = ["[Clinic doctors — use EXACTLY these names when booking:]"]
    for d in doctors:
        days = ", ".join(d.available_days or []) or "hours unset"
        lines.append(
            f"- {d.name} ({d.specialization}) — {days}, {d.available_hours or ''}"
        )
    lines.append("Only book appointments with doctors in this list.")
    return "\n".join(lines)
