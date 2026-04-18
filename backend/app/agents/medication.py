"""Medication agent — answers questions about common medications."""
from typing import TYPE_CHECKING, Any

from app.agents.base import (
    BaseAgent,
    END_CALL_TOOL,
    MID_CONVERSATION_RULE,
    RESPONSE_STYLE,
    ROUTE_TO_AGENT_TOOL,
)
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = f"""You are the medication-information role for MediCall AI.
Always respond in English.

{MID_CONVERSATION_RULE}

Safety rules (non-negotiable):
- Never prescribe, never suggest doses, never diagnose.
- Only share GENERAL information about well-known medications.
- For anything personal or complex: tell the patient to consult their doctor or pharmacist.

Use lookup_medication_info first; if the drug is missing, fall back to search_medical_knowledge.
When done, call end_call.

{RESPONSE_STYLE}"""


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
            {
                "type": "function",
                "name": "search_medical_knowledge",
                "description": "Search the medical knowledge base for accurate information about medications, conditions, or symptoms.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Medical question or topic, e.g. 'side effects of ibuprofen' or 'chest pain symptoms'",
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

        if tool_name == "lookup_medication_info":
            med = arguments.get("medication_name", "").strip().lower()
            info = MEDICATION_DB.get(med)
            if not info:
                return {
                    "found": False,
                    "message": f"No information available for '{med}'. Please consult your pharmacist.",
                }
            return {"found": True, "medication": med, **info}

        if tool_name == "search_medical_knowledge":
            from app.services.qdrant_svc import search_medical_knowledge
            query = arguments.get("query", "")
            results = await search_medical_knowledge(query)
            if not results:
                return {"found": False, "message": "No specific information found. Please consult your pharmacist."}
            return {"found": True, "results": [r["text"] for r in results]}

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
