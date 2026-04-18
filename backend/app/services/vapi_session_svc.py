"""Build Vapi assistant configuration for each incoming call.

Vapi serverUrl mode: Vapi sends all events to our FastAPI server.
We respond with assistant config on 'assistant-request' events.

Multi-role design: we give Vapi the *union* of every agent's tools plus a
single multi-role system prompt. The assistant chooses the right tool based
on what the patient wants, rather than swapping assistants mid-call (which
Vapi's serverUrl mode does not support cleanly).
"""
import uuid
from typing import Any

from app.agents.base import RESPONSE_STYLE
from app.agents.emergency import EmergencyAgent
from app.agents.medication import MedicationAgent
from app.agents.router import agent_router
from app.agents.scheduling import SchedulingAgent
from app.agents.triage import TriageAgent
from app.services.qdrant_svc import search_patient_memory
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger
from app.utils.prompt_builder import build_clinic_context

logger = get_logger(__name__)


MULTI_ROLE_PROMPT = f"""You are MediCall AI — a single voice assistant that plays four roles for a clinic:

1. Triage (default): greet, collect main symptom, assess urgency (1-10).
2. Scheduling: book / reschedule / cancel appointments. Available doctors: Dr. Smith (cardiology), Dr. Patel (general), Dr. Johnson (pediatrics). Hours Mon-Fri 9am-5pm.
3. Medication: general info on well-known medications only. NEVER prescribe, suggest doses, or diagnose.
4. Emergency: chest pain, breathing trouble, stroke signs, severe bleeding, unconscious. Tell patient to call 911. Use trigger_emergency_alert.

Pick the role based on what the patient wants. Don't announce the switch.

Always respond in English. Never diagnose. Never prescribe.
Call end_call when the patient has nothing left to ask.

{RESPONSE_STYLE}"""


def _union_tools() -> list[dict[str, Any]]:
    """All tools across every agent, deduped by name.

    One assistant, many capabilities — simpler than orchestrating Vapi squads.
    """
    by_name: dict[str, dict[str, Any]] = {}
    for agent in (TriageAgent(), SchedulingAgent(), MedicationAgent(), EmergencyAgent()):
        for tool in agent.get_tools():
            by_name[tool["name"]] = tool
    return list(by_name.values())


async def _memory_block(patient_id: uuid.UUID | None) -> str:
    """Fetch patient memory lazily — absent/unavailable Qdrant is fine."""
    if not patient_id:
        return ""
    try:
        memories = await search_patient_memory(patient_id, "patient history", limit=5)
    except Exception as exc:
        logger.warning("vapi_memory_fetch_failed", error=str(exc))
        return ""
    if not memories:
        return ""
    lines = ["[Patient memory from previous calls:]"]
    for m in memories:
        lines.append(f"- {m['text']}")
    return "\n".join(lines)


async def build_assistant_config(
    patient_name: str | None = None,
    patient_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Build dynamic Vapi assistant config for a new call."""
    prompt_parts: list[str] = []

    try:
        clinic = await build_clinic_context()
        if clinic:
            prompt_parts.append(clinic)
    except Exception as exc:
        logger.warning("vapi_clinic_context_failed", error=str(exc))

    memory = await _memory_block(patient_id)
    if memory:
        prompt_parts.append(memory)

    if patient_name:
        prompt_parts.append(f"The patient's name is {patient_name}.")

    prompt_parts.append(MULTI_ROLE_PROMPT)
    system_prompt = "\n\n".join(prompt_parts)

    server_url = get_effective("public_url")

    # agent_router is imported for its side effect of ensuring the registry exists
    _ = agent_router

    return {
        "assistant": {
            "name": "MediCall AI",
            "model": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "messages": [{"role": "system", "content": system_prompt}],
                "temperature": 0.4,
                "tools": _union_tools(),
            },
            "voice": {
                "provider": "11labs",
                "voiceId": "burt",
            },
            "transcriber": {
                "provider": "deepgram",
                "model": "nova-2",
                "language": "multi",
            },
            "firstMessage": "Hello, this is MediCall. How can I help?",
            "serverUrl": f"{server_url}/api/vapi/tool-call",
            "endCallMessage": "Take care.",
            "backgroundSound": "off",
            "backchannelingEnabled": True,
        }
    }
