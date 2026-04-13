"""Medication agent — answers questions about common medications."""
from typing import TYPE_CHECKING, Any

from app.agents.base import BaseAgent, END_CALL_TOOL, ROUTE_TO_AGENT_TOOL
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = """You are a medication information assistant for MediCall AI.

CRITICAL SAFETY RULES:
- NEVER prescribe medications or suggest doses.
- NEVER diagnose conditions.
- ALWAYS recommend the patient consult their doctor or pharmacist for personal advice.
- Only provide GENERAL information about well-known medications.

Use the lookup_medication_info tool to fetch general information. If a medication is
not in the database or the question is complex, refer the patient to their pharmacist.

When done answering, call route_to_agent to return to triage.

When you have fully addressed the patient's concerns, always ask: 'Is there anything else I can help you with today?' If they say no or indicate they are done, call the end_call tool immediately."""


MEDICATION_DB: dict[str, dict[str, Any]] = {
    "ibuprofen": {
        "category": "NSAID (pain reliever)",
        "common_uses": ["pain", "fever", "inflammation"],
        "common_side_effects": ["stomach upset", "heartburn"],
        "interactions": ["blood thinners", "aspirin"],
        "general_notes": "Take with food to reduce stomach irritation.",
    },
    "acetaminophen": {
        "category": "analgesic",
        "common_uses": ["pain", "fever"],
        "common_side_effects": ["rare at recommended doses"],
        "interactions": ["alcohol (liver risk)"],
        "general_notes": "Avoid exceeding recommended daily dose due to liver toxicity risk.",
    },
    "lisinopril": {
        "category": "ACE inhibitor",
        "common_uses": ["high blood pressure", "heart failure"],
        "common_side_effects": ["dry cough", "dizziness"],
        "interactions": ["potassium supplements", "NSAIDs"],
        "general_notes": "Usually taken once daily.",
    },
    "metformin": {
        "category": "antidiabetic",
        "common_uses": ["type 2 diabetes"],
        "common_side_effects": ["GI upset"],
        "interactions": ["alcohol", "contrast dye"],
        "general_notes": "Take with meals.",
    },
    "amoxicillin": {
        "category": "antibiotic (penicillin class)",
        "common_uses": ["bacterial infections"],
        "common_side_effects": ["diarrhea", "rash"],
        "interactions": ["oral contraceptives (reduced efficacy)"],
        "general_notes": "Finish the full prescribed course even if feeling better.",
    },
    "atorvastatin": {
        "category": "statin",
        "common_uses": ["high cholesterol"],
        "common_side_effects": ["muscle aches"],
        "interactions": ["grapefruit juice"],
        "general_notes": "Usually taken in the evening.",
    },
    "albuterol": {
        "category": "bronchodilator",
        "common_uses": ["asthma", "COPD"],
        "common_side_effects": ["tremor", "rapid heart rate"],
        "interactions": ["beta blockers"],
        "general_notes": "Rescue inhaler — for acute symptoms.",
    },
    "warfarin": {
        "category": "anticoagulant",
        "common_uses": ["blood clot prevention"],
        "common_side_effects": ["bleeding risk"],
        "interactions": ["many drugs and foods — consult pharmacist"],
        "general_notes": "Requires regular INR blood tests.",
    },
}


class MedicationAgent(BaseAgent):
    name = "medication"
    description = "Answers general medication questions"

    def get_system_prompt(self) -> str:
        return SYSTEM_PROMPT

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            ROUTE_TO_AGENT_TOOL,
            {
                "type": "function",
                "name": "lookup_medication_info",
                "description": "Look up general information about a medication.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "medication_name": {"type": "string"},
                    },
                    "required": ["medication_name"],
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

        if tool_name == "lookup_medication_info":
            med = arguments.get("medication_name", "").strip().lower()
            info = MEDICATION_DB.get(med)
            if not info:
                return {
                    "found": False,
                    "message": f"No information available for '{med}'. Please consult your pharmacist.",
                }
            return {"found": True, "medication": med, **info}

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
