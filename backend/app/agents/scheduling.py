"""Scheduling agent — books, reschedules, cancels appointments."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.agents.base import BaseAgent, END_CALL_TOOL, ROUTE_TO_AGENT_TOOL
from app.database import db_session
from app.models import Appointment, AppointmentStatus
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = """You are a scheduling assistant for MediCall AI.
Always respond in English, regardless of the language the caller uses.

You help patients:
- Book new appointments with their doctor
- Reschedule existing appointments
- Cancel appointments

Always confirm the doctor name, date, and time clearly by repeating it back to the patient.
Available doctors: Dr. Smith (cardiology), Dr. Patel (general), Dr. Johnson (pediatrics).
Clinic hours: Mon-Fri 9am-5pm.

When the scheduling is complete, call route_to_agent to return to triage.

When you have fully addressed the patient's concerns, always ask: 'Is there anything else I can help you with today?' If they say no or indicate they are done, call the end_call tool immediately."""


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
            return {"status": "routing", "target": arguments.get("agent_name")}

        if tool_name == "check_availability":
            doctor = arguments.get("doctor_name", "")
            now = datetime.now(timezone.utc)
            # Mock slots: next 5 weekdays at 10am and 2pm
            slots = []
            day = now + timedelta(days=1)
            while len(slots) < 6:
                if day.weekday() < 5:
                    slots.append(day.replace(hour=10, minute=0, second=0, microsecond=0).isoformat())
                    slots.append(day.replace(hour=14, minute=0, second=0, microsecond=0).isoformat())
                day += timedelta(days=1)
            return {"doctor_name": doctor, "available_slots": slots[:6]}

        if tool_name == "book_appointment":
            try:
                scheduled = datetime.fromisoformat(arguments["scheduled_at_iso"])
            except (ValueError, KeyError):
                return {"status": "error", "message": "Invalid datetime format"}

            async with db_session() as db:
                appt = Appointment(
                    patient_id=session.patient_id,
                    doctor_name=arguments["doctor_name"],
                    scheduled_at=scheduled,
                    status=AppointmentStatus.CONFIRMED,
                    notes=arguments.get("notes", ""),
                )
                db.add(appt)
                await db.flush()
                await db.commit()
                return {
                    "status": "confirmed",
                    "appointment_id": str(appt.id),
                    "doctor_name": appt.doctor_name,
                    "scheduled_at": appt.scheduled_at.isoformat(),
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

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
