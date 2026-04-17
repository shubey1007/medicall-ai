"""Emergency agent — activated for critical symptoms, notifies on-call staff."""
import asyncio
from typing import TYPE_CHECKING, Any

from twilio.rest import Client as TwilioClient

from app.agents.base import BaseAgent, END_CALL_TOOL, ROUTE_TO_AGENT_TOOL
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.services.call_manager import CallSession

logger = get_logger(__name__)


SYSTEM_PROMPT = """You are an emergency response assistant for MediCall AI. You are ONLY
activated when a patient is reporting a medical emergency.
Always respond in English, regardless of the language the caller uses.


YOUR PRIORITIES (in order):
1. Tell the patient to call 911 or go to the nearest emergency room IMMEDIATELY if they
   are in life-threatening distress. Repeat this clearly.
2. Collect essential information: location, main symptoms, whether anyone is with them.
3. Use trigger_emergency_alert to notify the on-call clinic staff.
4. Stay calm. Reassure the patient that help is coming.
5. Do NOT attempt to diagnose. Do NOT give medical advice beyond "call 911."

Keep the conversation focused and brief. Every second counts."""


class EmergencyAgent(BaseAgent):
    name = "emergency"
    description = "Handles critical medical emergencies"

    def get_system_prompt(self) -> str:
        return SYSTEM_PROMPT

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            ROUTE_TO_AGENT_TOOL,
            {
                "type": "function",
                "name": "trigger_emergency_alert",
                "description": "Send an SMS alert to on-call clinic staff about this emergency.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symptoms": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "severity_description": {"type": "string"},
                        "patient_location": {"type": "string"},
                    },
                    "required": ["symptoms", "severity_description"],
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

        if tool_name == "trigger_emergency_alert":
            oncall = get_effective("oncall_phone_number")
            if not oncall:
                logger.warning("emergency_alert_skipped", reason="no_oncall_number")
                return {"status": "noop", "reason": "No on-call number configured"}

            symptoms = ", ".join(arguments.get("symptoms", []))
            severity = arguments.get("severity_description", "unspecified")
            location = arguments.get("patient_location", "unknown")

            body = (
                f"[MediCall EMERGENCY] Patient {session.patient_phone}: "
                f"symptoms={symptoms}; severity={severity}; location={location}; "
                f"call_sid={session.call_sid}"
            )

            try:
                client = TwilioClient(
                    get_effective("twilio_account_sid"),
                    get_effective("twilio_auth_token"),
                )
                await asyncio.to_thread(
                    client.messages.create,
                    body=body,
                    from_=get_effective("twilio_phone_number"),
                    to=oncall,
                )
                logger.info(
                    "emergency_alert_sent",
                    call_sid=session.call_sid,
                    to=oncall,
                )
                return {"status": "alert_sent", "notified": settings.oncall_phone_number}
            except Exception as exc:
                logger.exception("emergency_alert_failed", error=str(exc))
                return {"status": "error", "message": "Alert failed, please call 911 directly"}

        logger.warning("unknown_tool_call", tool=tool_name, agent=self.name)
        return {"status": "error", "message": f"Unknown tool '{tool_name}'"}
