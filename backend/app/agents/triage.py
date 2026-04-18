"""Initial triage agent — greets patient, collects symptoms, routes."""
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.agents.base import BaseAgent, END_CALL_TOOL, RESPONSE_STYLE, ROUTE_TO_AGENT_TOOL
from app.database import db_session
from app.models import Patient
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = f"""You are the triage role for MediCall AI, a clinic phone service.
Always respond in English.

Your job:
1. Greet briefly and ask why they called.
2. Collect only what's needed: main symptom, onset, severity (1-10).
3. Assess urgency and route:
   - Chest pain, breathing trouble, stroke signs, severe bleeding, unconscious → route to emergency NOW.
   - Dosage / side-effect / interaction questions → route to medication.
   - Booking / rescheduling / cancelling → route to scheduling.
   - Otherwise stay on the line and answer.
4. Never diagnose, never prescribe. When routing, pass collected facts in route_to_agent.context.

Call end_call when the patient has nothing left to ask.

{RESPONSE_STYLE}"""


class TriageAgent(BaseAgent):
    name = "triage"
    description = "Greets patients, collects symptoms, routes to specialists"

    def get_system_prompt(self) -> str:
        return SYSTEM_PROMPT

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            ROUTE_TO_AGENT_TOOL,
            {
                "type": "function",
                "name": "assess_urgency",
                "description": "Classify the urgency level of reported symptoms.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symptoms": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of reported symptoms",
                        },
                        "severity": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 10,
                            "description": "Pain/discomfort severity 1-10",
                        },
                    },
                    "required": ["symptoms"],
                },
            },
            {
                "type": "function",
                "name": "lookup_patient",
                "description": (
                    "Look up a patient by phone number or name. "
                    "Provide 'phone' (digits only, no spaces/dashes/country code) OR 'name'. "
                    "Try phone first; if not found, try name."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone": {
                            "type": "string",
                            "description": "Digits only — strip spaces, dashes, country codes (+91, 0091, leading 0).",
                        },
                        "name": {
                            "type": "string",
                            "description": "Patient's full or partial name as spoken.",
                        },
                    },
                },
            },
            {
                "type": "function",
                "name": "recall_patient_memory",
                "description": "Search the patient's memory from previous calls to understand their history, past symptoms, or medications.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "What to search for, e.g. 'previous symptoms' or 'medications mentioned before'",
                        }
                    },
                    "required": ["query"],
                },
            },
            {
                "type": "function",
                "name": "find_doctor",
                "description": "Semantically search for a doctor based on specialization, availability, or patient needs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural language description of what's needed, e.g. 'heart specialist available on Monday'",
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
            return {
                "status": "routing",
                "target": arguments.get("agent_name"),
                "reason": arguments.get("reason"),
            }

        if tool_name == "assess_urgency":
            symptoms = [s.lower() for s in arguments.get("symptoms", [])]
            severity = arguments.get("severity", 0)

            critical_keywords = [
                "chest pain", "difficulty breathing", "shortness of breath",
                "unconscious", "stroke", "severe bleeding", "overdose",
                "suicide", "heart attack",
            ]
            high_keywords = ["fever", "vomiting", "severe pain", "dizzy"]

            if any(k in " ".join(symptoms) for k in critical_keywords) or severity >= 9:
                level = "critical"
            elif any(k in " ".join(symptoms) for k in high_keywords) or severity >= 7:
                level = "high"
            elif severity >= 4:
                level = "medium"
            else:
                level = "low"

            return {
                "urgency_level": level,
                "reasoning": f"Based on symptoms {symptoms} and severity {severity}",
            }

        if tool_name == "lookup_patient":
            import re
            from sqlalchemy import func

            def _normalize(raw: str) -> str:
                """Strip non-digits, drop leading country codes."""
                digits = re.sub(r"\D", "", raw)
                # Drop +91 / 0091 prefix, or a leading 0 before 10 digits
                if digits.startswith("91") and len(digits) == 12:
                    digits = digits[2:]
                elif digits.startswith("0091") and len(digits) == 14:
                    digits = digits[4:]
                elif digits.startswith("0") and len(digits) == 11:
                    digits = digits[1:]
                return digits

            raw_phone = arguments.get("phone") or session.patient_phone
            name_query = arguments.get("name", "").strip()

            async with db_session() as db:
                patient = None

                # 1. Try phone match (exact suffix — handles stored formats like +91XXXXXXXXXX)
                if raw_phone and raw_phone not in ("unknown", "vapi-demo"):
                    normalized = _normalize(raw_phone)
                    if normalized:
                        result = await db.execute(
                            select(Patient).where(Patient.phone.like(f"%{normalized}"))
                        )
                        patient = result.scalar_one_or_none()

                # 2. Fall back to name search
                if patient is None and name_query:
                    result = await db.execute(
                        select(Patient).where(
                            func.lower(Patient.name).contains(name_query.lower())
                        )
                    )
                    patient = result.scalar_one_or_none()

                if not patient:
                    return {"found": False, "message": "Patient not found by phone or name."}
                return {
                    "found": True,
                    "name": patient.name,
                    "medical_context": patient.medical_context,
                }

        if tool_name == "recall_patient_memory":
            if not session.patient_id:
                return {"found": False, "message": "Patient identity not established for this session."}
            from app.services.qdrant_svc import search_patient_memory
            query = arguments.get("query", "patient history")
            memories = await search_patient_memory(session.patient_id, query)
            if not memories:
                return {"found": False, "message": "No previous memories found for this patient."}
            return {"found": True, "memories": [m["text"] for m in memories]}

        if tool_name == "find_doctor":
            from app.services.qdrant_svc import search_doctors
            query = arguments.get("query", "general doctor")
            doctors = await search_doctors(query)
            if not doctors:
                return {"found": False, "message": "No matching doctors found."}
            return {"found": True, "doctors": doctors}

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
