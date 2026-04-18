"""Scheduling agent — books, reschedules, cancels appointments."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.agents.base import (
    BaseAgent,
    END_CALL_TOOL,
    MID_CONVERSATION_RULE,
    RESPONSE_STYLE,
    ROUTE_TO_AGENT_TOOL,
)
from app.database import db_session
from app.models import Appointment, AppointmentStatus
from app.models.doctor import Doctor
from app.utils.logger import get_logger
from app.websocket import dashboard_ws


def _normalize(s: str) -> str:
    """Fuzzy-match key: lowercase, strip whitespace, strip 'dr.' prefix."""
    s = (s or "").strip().lower()
    if s.startswith("dr."):
        s = s[3:].strip()
    elif s.startswith("dr "):
        s = s[3:].strip()
    return s


async def _resolve_doctor(raw_name: str) -> Doctor | None:
    """Map whatever string the LLM produced to a real Doctor row.

    Tries: exact case-insensitive → exact-after-normalization → substring.
    Returns None if no active doctor matches.
    """
    if not raw_name or not raw_name.strip():
        return None
    target = _normalize(raw_name)
    async with db_session() as db:
        result = await db.execute(select(Doctor).where(Doctor.is_active.is_(True)))
        doctors = result.scalars().all()

    # 1: exact case-insensitive
    for d in doctors:
        if d.name.lower().strip() == raw_name.lower().strip():
            return d
    # 2: normalized equality ("Dr. Smith" vs "Smith")
    for d in doctors:
        if _normalize(d.name) == target:
            return d
    # 3: normalized substring match ("Smith" vs "Sarah Smith")
    for d in doctors:
        if target and target in _normalize(d.name):
            return d
    for d in doctors:
        if target and _normalize(d.name) in target:
            return d
    return None


async def _active_doctor_names() -> list[str]:
    async with db_session() as db:
        result = await db.execute(
            select(Doctor.name).where(Doctor.is_active.is_(True)).order_by(Doctor.name.asc())
        )
        return [row for (row,) in result.all()]

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


def _parse_datetime(raw: str) -> datetime | None:
    """Best-effort datetime parse. Accepts:
      - "2026-04-22T14:30:00"        (naive ISO)
      - "2026-04-22T14:30:00Z"       (UTC, py3.11+)
      - "2026-04-22T14:30:00+00:00"  (offset)
      - "2026-04-22 14:30"           (space-separated, no seconds)
    Returns None on any parse failure so the caller can surface a clean error
    instead of raising.
    """
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    # Python 3.11 supports Z, older doesn't — normalize defensively.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    # Fall back to common variants the LLM sometimes emits
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    # Strip trailing "AM/PM" if any — "2026-04-22T10:00:00 AM"
    m = re.match(r"^(.*?)\s*(AM|PM)$", s, flags=re.IGNORECASE)
    if m:
        base, mer = m.group(1).strip(), m.group(2).upper()
        try:
            dt = datetime.fromisoformat(base)
            if mer == "PM" and dt.hour < 12:
                dt = dt.replace(hour=dt.hour + 12)
            if mer == "AM" and dt.hour == 12:
                dt = dt.replace(hour=0)
            return dt
        except ValueError:
            return None
    return None


SYSTEM_PROMPT = f"""You are the scheduling role for MediCall AI.
Always respond in English.

{MID_CONVERSATION_RULE}

You help patients book, reschedule, or cancel appointments. The clinic's current doctor roster is provided separately (see "Clinic doctors" block above) — only book with names from that list, copied VERBATIM.

Workflow:
1. If unsure who the patient wants, ask by specialty; do NOT invent names.
2. ALWAYS call check_availability(doctor_name=<exact name from the roster>) before proposing a time. Only offer slots it returned. Never invent times.
3. Confirm doctor + date + time once, in a single short sentence, then call book_appointment with scheduled_at_iso in ISO 8601 (e.g. 2026-04-22T14:30:00).
4. If book_appointment returns status=conflict, apologise once and offer the next slot check_availability returned.
5. If a tool returns status=unknown_doctor, read back the known names and let the patient pick.
6. After booking or cancelling, call end_call if the patient has no other request.

{RESPONSE_STYLE}"""


class SchedulingAgent(BaseAgent):
    name = "scheduling"
    description = "Books and manages appointments"

    def get_system_prompt(self) -> str:
        return SYSTEM_PROMPT

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            ROUTE_TO_AGENT_TOOL,
            {
                "type": "function",
                "name": "check_availability",
                "description": "Check when a doctor has availability in the next 14 days.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "doctor_name": {"type": "string"},
                    },
                    "required": ["doctor_name"],
                },
            },
            {
                "type": "function",
                "name": "book_appointment",
                "description": "Book a new appointment for the current patient.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "doctor_name": {"type": "string"},
                        "scheduled_at_iso": {
                            "type": "string",
                            "description": "ISO 8601 datetime",
                        },
                        "notes": {"type": "string"},
                    },
                    "required": ["doctor_name", "scheduled_at_iso"],
                },
            },
            {
                "type": "function",
                "name": "cancel_appointment",
                "description": "Cancel an existing appointment by ID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "appointment_id": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["appointment_id"],
                },
            },
            {
                "type": "function",
                "name": "find_doctor",
                "description": "Semantically search for a doctor by specialization or availability.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural language description, e.g. 'cardiologist available on Monday morning'",
                        }
                    },
                    "required": ["query"],
                },
            },
            END_CALL_TOOL,
        ]

    async def handle_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: "CallSession",
    ) -> dict[str, Any]:
        if tool_name == "end_call":
            return {"action": "end_call", "reason": arguments.get("reason", "")}

        if tool_name == "route_to_agent":
            session.handoff_context = {
                "from_agent": self.name,
                "reason": arguments.get("reason", ""),
                "context": arguments.get("context", {}),
            }
            return {"status": "routing", "target": arguments.get("agent_name")}

        if tool_name == "check_availability":
            raw_doctor = (arguments.get("doctor_name") or "").strip()
            if not raw_doctor:
                return {"status": "error", "message": "Missing doctor_name."}

            resolved = await _resolve_doctor(raw_doctor)
            if resolved is None:
                known = await _active_doctor_names()
                return {
                    "status": "unknown_doctor",
                    "message": f"No active doctor matches '{raw_doctor}'. Ask the patient to pick one.",
                    "known_doctors": known,
                }
            doctor = resolved.name  # canonical name from DB

            now = datetime.now(timezone.utc)
            horizon = now + timedelta(days=14)

            # Candidate slots: next 14 weekdays at 10:00 and 14:00 UTC.
            candidates: list[datetime] = []
            day = now + timedelta(days=1)
            day = day.replace(hour=0, minute=0, second=0, microsecond=0)
            while day < horizon:
                if day.weekday() < 5:
                    candidates.append(day.replace(hour=10))
                    candidates.append(day.replace(hour=14))
                day += timedelta(days=1)

            # Real DB check — any non-cancelled appointment for this doctor in
            # the horizon. A slot is "taken" if an existing appointment falls
            # within ±15 minutes. This is the same window book_appointment uses,
            # so the agent never proposes a slot it's about to reject.
            async with db_session() as db:
                result = await db.execute(
                    select(Appointment).where(
                        Appointment.doctor_name == doctor,
                        Appointment.status != AppointmentStatus.CANCELLED,
                        Appointment.scheduled_at >= now,
                        Appointment.scheduled_at <= horizon,
                    )
                )
                booked = [a.scheduled_at for a in result.scalars().all()]

            window = timedelta(minutes=15)

            def _clash(slot: datetime) -> bool:
                for b in booked:
                    b_aware = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
                    if abs((slot - b_aware).total_seconds()) <= window.total_seconds():
                        return True
                return False

            free = [c.isoformat() for c in candidates if not _clash(c)][:6]

            if not free:
                return {
                    "doctor_name": doctor,
                    "available_slots": [],
                    "message": f"{doctor} has no open slots in the next 14 days.",
                }
            return {
                "doctor_name": doctor,
                "available_slots": free,
                "timezone_note": "Slots are UTC. Convert to the patient's local time before speaking.",
            }

        if tool_name == "book_appointment":
            if not getattr(session, "patient_id", None):
                # Vapi demo path has no DB patient; fail loudly so the LLM
                # stops pretending it booked something that doesn't exist.
                logger.warning(
                    "book_appointment_no_patient",
                    call_sid=getattr(session, "call_sid", "?"),
                )
                return {
                    "status": "error",
                    "message": "Cannot book — no patient on this call. Ask the patient to call from a registered number.",
                }

            raw = arguments.get("scheduled_at_iso", "") or arguments.get("scheduled_at", "")
            scheduled = _parse_datetime(raw)
            if scheduled is None:
                logger.warning(
                    "book_appointment_bad_datetime",
                    raw=raw,
                    call_sid=getattr(session, "call_sid", "?"),
                )
                return {
                    "status": "error",
                    "message": (
                        f"Could not parse '{raw}'. Use ISO 8601 like 2026-04-22T14:30:00. "
                        "Confirm a specific date and time with the patient and retry."
                    ),
                }
            # If naive, assume UTC — Appointment.scheduled_at is timezone-aware.
            if scheduled.tzinfo is None:
                scheduled = scheduled.replace(tzinfo=timezone.utc)

            raw_doctor = (arguments.get("doctor_name") or "").strip()
            if not raw_doctor:
                return {"status": "error", "message": "Missing doctor_name."}

            resolved = await _resolve_doctor(raw_doctor)
            if resolved is None:
                known = await _active_doctor_names()
                return {
                    "status": "unknown_doctor",
                    "message": (
                        f"No active doctor matches '{raw_doctor}'. Ask the patient "
                        "to pick one and retry."
                    ),
                    "known_doctors": known,
                }
            doctor_name = resolved.name  # canonical name stored on Appointment

            # Conflict check — same guard as the REST endpoint so the agent
            # can't double-book.
            window = timedelta(minutes=15)
            async with db_session() as db:
                conflict = await db.execute(
                    select(Appointment).where(
                        Appointment.doctor_name == doctor_name,
                        Appointment.status != AppointmentStatus.CANCELLED,
                        Appointment.scheduled_at >= scheduled - window,
                        Appointment.scheduled_at <= scheduled + window,
                    )
                )
                if conflict.scalars().first():
                    return {
                        "status": "conflict",
                        "message": f"{doctor_name} is busy near {scheduled.isoformat()}. Offer another slot.",
                    }

                appt = Appointment(
                    patient_id=session.patient_id,
                    doctor_name=doctor_name,
                    scheduled_at=scheduled,
                    status=AppointmentStatus.CONFIRMED,
                    notes=arguments.get("notes", ""),
                )
                db.add(appt)
                await db.flush()
                await db.commit()
                await db.refresh(appt)

                payload_id = str(appt.id)
                payload_doctor = appt.doctor_name
                payload_when = appt.scheduled_at.isoformat()
                payload_patient_id = str(appt.patient_id)

            # Let the dashboard know immediately — Appointments page rehydrates
            # from this event rather than polling.
            try:
                await dashboard_ws.emit_appointment_created({
                    "appointmentId": payload_id,
                    "patientId": payload_patient_id,
                    "doctorName": payload_doctor,
                    "scheduledAt": payload_when,
                    "callSid": getattr(session, "call_sid", None),
                })
            except Exception as exc:
                logger.warning("emit_appointment_created_failed", error=str(exc))

            logger.info(
                "appointment_booked_by_agent",
                appointment_id=payload_id,
                doctor=payload_doctor,
                scheduled_at=payload_when,
                call_sid=getattr(session, "call_sid", "?"),
            )
            return {
                "status": "confirmed",
                "appointment_id": payload_id,
                "doctor_name": payload_doctor,
                "scheduled_at": payload_when,
            }

        if tool_name == "cancel_appointment":
            try:
                appt_id = uuid.UUID(arguments.get("appointment_id", ""))
            except ValueError:
                return {"status": "error", "message": "Invalid appointment ID"}

            async with db_session() as db:
                result = await db.execute(select(Appointment).where(Appointment.id == appt_id))
                appt = result.scalar_one_or_none()
                if not appt:
                    return {"status": "not_found"}
                appt.status = AppointmentStatus.CANCELLED
                await db.commit()
                return {"status": "cancelled", "appointment_id": str(appt.id)}

        if tool_name == "find_doctor":
            from app.services.qdrant_svc import search_doctors
            doctors = await search_doctors(arguments.get("query", ""))
            return {"found": bool(doctors), "doctors": doctors}

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
