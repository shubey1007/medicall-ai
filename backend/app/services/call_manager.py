"""Tracks active calls in-memory for the voice pipeline and dashboard."""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from app.utils.logger import get_logger

if TYPE_CHECKING:
    from fastapi import WebSocket
    from app.websocket.openai_bridge import OpenAIRealtimeBridge

logger = get_logger(__name__)


@dataclass
class CallSession:
    call_sid: str
    stream_sid: str
    db_call_id: uuid.UUID
    patient_phone: str
    patient_id: uuid.UUID
    twilio_ws: "WebSocket"
    openai_bridge: "OpenAIRealtimeBridge | None" = None
    current_agent: str = "triage"
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finalized: bool = False
    patient_name: str | None = None
    # Set by route_to_agent tool: the previous agent's reason + structured context.
    # Consumed once by openai_bridge.configure_session() and cleared after use.
    handoff_context: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "callSid": self.call_sid,
            "patientPhone": self.patient_phone,
            "patientName": self.patient_name,
            "currentAgent": self.current_agent,
            "startedAt": self.started_at.isoformat(),
        }


class CallManager:
    """In-memory singleton tracking active CallSessions by call_sid.

    Single asyncio event loop only — not thread-safe.
    """

    def __init__(self) -> None:
        self._active: dict[str, CallSession] = {}

    def register(self, session: CallSession) -> None:
        self._active[session.call_sid] = session
        logger.info("call_registered", call_sid=session.call_sid)

    def get(self, call_sid: str) -> CallSession | None:
        return self._active.get(call_sid)

    def end(self, call_sid: str) -> CallSession | None:
        session = self._active.pop(call_sid, None)
        if session:
            logger.info("call_ended", call_sid=call_sid)
        return session

    def list_active(self) -> list[CallSession]:
        return list(self._active.values())

    def set_agent(self, call_sid: str, agent_name: str) -> None:
        session = self._active.get(call_sid)
        if session:
            session.current_agent = agent_name


call_manager = CallManager()
