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
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.agents.base import BaseAgent
from app.agents.emergency import EmergencyAgent
from app.agents.medication import MedicationAgent
from app.agents.scheduling import SchedulingAgent
from app.agents.triage import TriageAgent
from app.database import db_session
from app.models import Call, CallStatus, Patient
from app.services.vapi_session_svc import build_assistant_config
from app.utils.logger import get_logger
from app.websocket import dashboard_ws

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
        call_data = message.get("call", {})
        caller_phone = (call_data.get("customer") or {}).get("number")
        config = await build_assistant_config(caller_phone=caller_phone)
        return JSONResponse(content=config)

    if msg_type == "status-update":
        status = message.get("status", "")
        call_data = message.get("call", {})
        phone = (call_data.get("customer") or {}).get("number") or "vapi-demo"
        logger.info("vapi_call_status", call_id=call_id, status=status)

        if status in ("ringing", "in-progress") and call_id:
            async with db_session() as db:
                # Find or create a patient record for this caller
                result = await db.execute(select(Patient).where(Patient.phone == phone))
                patient = result.scalar_one_or_none()
                if patient is None:
                    patient = Patient(phone=phone, name="Vapi Demo Caller")
                    db.add(patient)
                    await db.flush()

                # Only create the call row once (ringing arrives before in-progress)
                result = await db.execute(select(Call).where(Call.call_sid == call_id))
                existing = result.scalar_one_or_none()
                if existing is None:
                    call_row = Call(
                        call_sid=call_id,
                        patient_id=patient.id,
                        status=CallStatus.RINGING if status == "ringing" else CallStatus.ACTIVE,
                    )
                    db.add(call_row)
                    await db.commit()
                    await db.refresh(call_row)
                    await dashboard_ws.emit_call_started({
                        "callSid": call_id,
                        "patientPhone": phone,
                        "patientName": patient.name,
                        "agent": "triage",
                        "startedAt": call_row.started_at.isoformat(),
                    })
                elif status == "in-progress" and existing.status == CallStatus.RINGING:
                    existing.status = CallStatus.ACTIVE
                    await db.commit()

        elif status == "ended" and call_id:
            duration: int | None = None
            async with db_session() as db:
                result = await db.execute(select(Call).where(Call.call_sid == call_id))
                call_row = result.scalar_one_or_none()
                if call_row is not None and call_row.status not in (
                    CallStatus.COMPLETED, CallStatus.FAILED
                ):
                    now = datetime.now(timezone.utc)
                    duration = int((now - call_row.started_at).total_seconds())
                    call_row.status = CallStatus.COMPLETED
                    call_row.ended_at = now
                    call_row.duration_seconds = duration
                    await db.commit()
            await dashboard_ws.emit_call_ended({"callSid": call_id, "duration": duration})

        return JSONResponse(content={"received": True})

    if msg_type == "end-of-call-report":
        transcript = message.get("transcript", "")
        duration_seconds = message.get("durationSeconds") or message.get("call", {}).get("durationSeconds")
        logger.info("vapi_call_ended", call_id=call_id, transcript_len=len(transcript))

        # Ensure the call row is marked completed with accurate duration
        if call_id:
            async with db_session() as db:
                result = await db.execute(select(Call).where(Call.call_sid == call_id))
                call_row = result.scalar_one_or_none()
                if call_row is not None and call_row.status not in (
                    CallStatus.COMPLETED, CallStatus.FAILED
                ):
                    now = datetime.now(timezone.utc)
                    call_row.status = CallStatus.COMPLETED
                    call_row.ended_at = now
                    call_row.duration_seconds = int(duration_seconds) if duration_seconds else int(
                        (now - call_row.started_at).total_seconds()
                    )
                    await db.commit()
            await dashboard_ws.emit_call_ended({
                "callSid": call_id,
                "duration": int(duration_seconds) if duration_seconds else None,
            })

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

    if msg_type == "transcript":
        transcript_type = message.get("transcriptType", "")
        if transcript_type == "final" and call_id:
            role = message.get("role", "user")
            text = message.get("transcript", "")
            if text.strip():
                await dashboard_ws.emit_transcript({
                    "callSid": call_id,
                    "role": role,
                    "content": text,
                    "agentName": "triage",
                })
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
