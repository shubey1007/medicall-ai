"""Vapi serverUrl webhook handler.

Vapi calls POST /api/vapi/webhook for call lifecycle events:
  - assistant-request    → respond with assistant config
  - status-update        → call started/ended notifications
  - end-of-call-report   → transcript + summary

Vapi calls POST /api/vapi/tool-call for function calls from the AI:
  - function-call        → route to agent tool handlers
"""
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.agents.emergency import EmergencyAgent
from app.agents.medication import MedicationAgent
from app.agents.scheduling import SchedulingAgent
from app.agents.triage import TriageAgent
from app.services.vapi_session_svc import build_assistant_config
from app.utils.logger import get_logger

router = APIRouter(prefix="/api/vapi", tags=["vapi"])
logger = get_logger(__name__)

# In-memory per-call state: call_id → current agent name
# (Fine for demo scale; not replicated across workers)
_call_agents: dict[str, str] = {}

_agent_registry: dict[str, Any] = {
    "triage": TriageAgent(),
    "scheduling": SchedulingAgent(),
    "medication": MedicationAgent(),
    "emergency": EmergencyAgent(),
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
        config = build_assistant_config()
        _call_agents[call_id] = "triage"
        return JSONResponse(content=config)

    if msg_type == "status-update":
        status = message.get("status", "")
        logger.info("vapi_call_status", call_id=call_id, status=status)
        if status == "ended":
            _call_agents.pop(call_id, None)
        return JSONResponse(content={"received": True})

    if msg_type == "end-of-call-report":
        transcript = message.get("transcript", "")
        logger.info("vapi_call_ended", call_id=call_id, transcript_len=len(transcript))
        # Trigger memory consolidation for demo calls (no DB patient_id — skipped gracefully)
        if transcript.strip():
            import asyncio
            from app.services import memory_svc
            asyncio.create_task(
                memory_svc.consolidate(
                    patient_id=None,   # type: ignore[arg-type]  # Vapi path has no DB patient
                    call_id=None,      # type: ignore[arg-type]
                    transcript_text=transcript,
                )
            )
        return JSONResponse(content={"received": True})

    return JSONResponse(content={"received": True})


@router.post("/tool-call")
async def vapi_tool_call(request: Request) -> JSONResponse:
    """Vapi tool-call endpoint — handles function calls from the AI model."""
    body: dict[str, Any] = await request.json()
    message = body.get("message", {})
    function_call = message.get("functionCall", {})
    tool_name: str = function_call.get("name", "")
    parameters_raw = function_call.get("parameters", "{}")
    call_id: str = message.get("call", {}).get("id", "")

    try:
        arguments = json.loads(parameters_raw) if isinstance(parameters_raw, str) else parameters_raw
    except json.JSONDecodeError:
        arguments = {}

    logger.info("vapi_tool_call", tool=tool_name, call_id=call_id)

    current_agent_name = _call_agents.get(call_id, "triage")

    if tool_name == "route_to_agent":
        target = arguments.get("agent_name", "triage")
        _call_agents[call_id] = target
        logger.info("vapi_agent_switched", call_id=call_id, from_agent=current_agent_name, to_agent=target)
        return JSONResponse(content={"result": f"Routing to {target} agent."})

    agent = _agent_registry.get(current_agent_name, _agent_registry["triage"])

    class _MockSession:
        """Minimal session for agent tool calls via Vapi (no DB session available)."""
        patient_id = None
        patient_phone = "unknown"
        call_sid = call_id
        current_agent = current_agent_name

    result = await agent.handle_tool_call(tool_name, arguments, _MockSession())
    return JSONResponse(content={"result": json.dumps(result)})
