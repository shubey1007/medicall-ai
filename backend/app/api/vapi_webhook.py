"""Vapi serverUrl webhook handler.

Vapi calls POST /api/vapi/webhook for call lifecycle events:
  - assistant-request    → respond with assistant config
  - status-update        → call started/ended notifications
  - end-of-call-report   → transcript + summary + memory consolidation

Vapi calls POST /api/vapi/tool-call for function calls from the AI:
  - function-call        → route to the right agent's tool handler

Multi-role model: the Vapi assistant holds the UNION of every agent's tools.
We dispatch each tool call to whichever agent declares it. This avoids
swapping assistants mid-call (which Vapi's serverUrl mode doesn't support
cleanly) while still letting every specialty actually work end-to-end.
"""
import asyncio
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.agents.base import BaseAgent
from app.agents.emergency import EmergencyAgent
from app.agents.medication import MedicationAgent
from app.agents.scheduling import SchedulingAgent
from app.agents.triage import TriageAgent
from app.services.vapi_session_svc import build_assistant_config
from app.utils.logger import get_logger

router = APIRouter(prefix="/api/vapi", tags=["vapi"])
logger = get_logger(__name__)

_triage = TriageAgent()
_scheduling = SchedulingAgent()
_medication = MedicationAgent()
_emergency = EmergencyAgent()

# Tool → agent that owns the implementation. Generic tools (route_to_agent,
# end_call) are handled by triage since the implementation is identical.
TOOL_OWNER: dict[str, BaseAgent] = {
    # Triage
    "assess_urgency": _triage,
    "lookup_patient": _triage,
    "recall_patient_memory": _triage,
    "find_doctor": _triage,
    # Scheduling
    "check_availability": _scheduling,
    "book_appointment": _scheduling,
    "cancel_appointment": _scheduling,
    # Medication
    "lookup_medication_info": _medication,
    "search_medical_knowledge": _medication,
    # Emergency
    "trigger_emergency_alert": _emergency,
    # Shared
    "route_to_agent": _triage,
    "end_call": _triage,
}


@router.post("/webhook")
async def vapi_webhook(request: Request) -> JSONResponse:
    """Main Vapi serverUrl webhook — handles lifecycle events."""
    body: dict[str, Any] = await request.json()
    message = body.get("message", {})
    msg_type = message.get("type", "")
    call_id = message.get("call", {}).get("id", "")

    logger.info("vapi_webhook", type=msg_type, call_id=call_id)

    if msg_type == "assistant-request":
        config = await build_assistant_config()
        return JSONResponse(content=config)

    if msg_type == "status-update":
        status = message.get("status", "")
        logger.info("vapi_call_status", call_id=call_id, status=status)
        return JSONResponse(content={"received": True})

    if msg_type == "end-of-call-report":
        transcript = message.get("transcript", "")
        logger.info("vapi_call_ended", call_id=call_id, transcript_len=len(transcript))
        # Demo path has no DB patient_id, so memory_svc will skip. That's fine.
        if transcript.strip():
            from app.services import memory_svc
            asyncio.create_task(
                memory_svc.consolidate(
                    patient_id=None,  # type: ignore[arg-type]
                    call_id=None,  # type: ignore[arg-type]
                    transcript_text=transcript,
                )
            )
        return JSONResponse(content={"received": True})

    return JSONResponse(content={"received": True})


@router.post("/tool-call")
async def vapi_tool_call(request: Request) -> JSONResponse:
    """Dispatch Vapi function calls to the agent that owns the tool."""
    body: dict[str, Any] = await request.json()
    message = body.get("message", {})
    function_call = message.get("functionCall", {})
    tool_name: str = function_call.get("name", "")
    parameters_raw = function_call.get("parameters", "{}")
    call_id: str = message.get("call", {}).get("id", "")

    try:
        arguments = (
            json.loads(parameters_raw) if isinstance(parameters_raw, str) else parameters_raw
        )
    except json.JSONDecodeError:
        arguments = {}

    logger.info("vapi_tool_call", tool=tool_name, call_id=call_id)

    # route_to_agent on Vapi is a no-op at the transport level (we only ever
    # have one assistant), but we acknowledge so the model's intent is captured
    # in the transcript and the dashboard can reflect the handoff.
    if tool_name == "route_to_agent":
        target = arguments.get("agent_name", "triage")
        reason = arguments.get("reason", "")
        logger.info("vapi_role_switch", call_id=call_id, to_agent=target, reason=reason)
        return JSONResponse(content={"result": f"Now handling as {target}."})

    agent = TOOL_OWNER.get(tool_name)
    if agent is None:
        logger.warning("vapi_unknown_tool", tool=tool_name, call_id=call_id)
        return JSONResponse(content={"result": f"Unknown tool '{tool_name}'."})

    class _MockSession:
        """Minimal session for agent tool calls via Vapi (no DB session available)."""
        patient_id = None
        patient_phone = "unknown"
        call_sid = call_id
        current_agent = "triage"
        handoff_context: dict[str, Any] = {}

    result = await agent.handle_tool_call(tool_name, arguments, _MockSession())
    return JSONResponse(content={"result": json.dumps(result)})
