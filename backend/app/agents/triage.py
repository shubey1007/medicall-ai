"""Initial triage agent — greets patient, collects symptoms, routes."""
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.agents.base import BaseAgent, END_CALL_TOOL, ROUTE_TO_AGENT_TOOL
from app.database import db_session
from app.models import Patient
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = """You are a warm, empathetic medical triage assistant for MediCall AI, a clinic phone service.
Always respond in English, regardless of the language the caller uses.

Your job is to:

1. Greet the caller warmly and ask how you can help.
2. Collect key symptoms: what they are, when they started, severity (1-10), and any relevant medications.
3. Assess urgency. Critical symptoms (chest pain, difficulty breathing, severe bleeding,
   stroke signs, loss of consciousness) → transfer to emergency IMMEDIATELY.
4. Route to the correct specialist:
   - Critical/high urgency → emergency
   - Medication questions (dosage, side effects, interactions) → medication
   - Booking/rescheduling/cancelling appointments → scheduling
   - General questions → stay with triage

Always speak clearly, confirm what you heard, and NEVER provide medical diagnoses or prescribe treatment.
Call the route_to_agent function when a handoff is needed.

When you have fully addressed the patient's concerns, always ask: 'Is there anything else I can help you with today?' If they say no or indicate they are done, call the end_call tool immediately."""


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
                "description": "Look up patient medical history by phone number.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone": {"type": "string"},
                    },
                    "required": ["phone"],
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
            phone = arguments.get("phone", session.patient_phone)
            async with db_session() as db:
                result = await db.execute(select(Patient).where(Patient.phone == phone))
                patient = result.scalar_one_or_none()
                if not patient:
                    return {"found": False}
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
