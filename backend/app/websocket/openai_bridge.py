"""Per-call bridge to OpenAI Real-Time API.

Lifecycle:
  1. connect() — opens wss://api.openai.com/v1/realtime?model=...
  2. configure_session(agent) — initial session.update with agent prompt + tools
  3. send_audio(pcm16_24k) — input_audio_buffer.append
  4. receive_loop() — consumes OAI events and dispatches
  5. update_session(agent) — swap agent (instructions + tools) mid-call
  6. disconnect() — clean close
"""
import asyncio
import base64
import json
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from app.models import TranscriptRole
from app.services.settings_svc import get_effective
from app.services.transcript_svc import transcript_service
from app.utils.logger import get_logger
from app.websocket import dashboard_ws
from app.websocket.audio_utils import pcm16_to_mulaw, resample_pcm16

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

    from app.agents.base import BaseAgent
    from app.services.call_manager import CallSession

logger = get_logger(__name__)

OAI_RT_URL = "wss://api.openai.com/v1/realtime"


class OpenAIRealtimeBridge:
    def __init__(
        self,
        session: "CallSession",
        on_tool_call: Callable[[str, dict[str, Any]], Awaitable[dict[str, Any] | None]],
    ) -> None:
        self.session = session
        self._on_tool_call = on_tool_call
        self._ws: "ClientConnection | None" = None
        self._recv_task: asyncio.Task | None = None
        self._closed = False
        self._current_agent: "BaseAgent | None" = None

    async def connect(self, initial_agent: "BaseAgent") -> None:
        model = get_effective("openai_realtime_model") or "gpt-4o-realtime-preview"
        url = f"{OAI_RT_URL}?model={model}"
        headers = {
            "Authorization": f"Bearer {get_effective('openai_api_key')}",
            "OpenAI-Beta": "realtime=v1",
        }
        # Use the asyncio client explicitly — websockets 13.x routes the top-level
        # websockets.connect() to the legacy client which doesn't support additional_headers.
        self._ws = await ws_connect(url, additional_headers=headers)
        logger.info("oai_bridge_connected", call_sid=self.session.call_sid)

        await self.configure_session(initial_agent)
        self._recv_task = asyncio.create_task(self._receive_loop())
        # Trigger immediate greeting from the agent
        await self._send({"type": "response.create"})

    async def configure_session(self, agent: "BaseAgent") -> None:
        self._current_agent = agent
        await self._send({
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": agent.get_system_prompt(),
                "voice": "alloy",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500,
                },
                "tools": agent.get_tools(),
                "tool_choice": "auto",
                "temperature": 0.7,
            },
        })
        logger.info("oai_session_configured", agent=agent.name, call_sid=self.session.call_sid)

    async def update_session(self, agent: "BaseAgent") -> None:
        """Swap agent mid-call without losing conversation context."""
        await self.configure_session(agent)
        # Trigger an immediate response so the new agent greets/acknowledges
        await self._send({"type": "response.create"})

    async def send_audio(self, pcm16_24k: bytes) -> None:
        if self._ws is None or self._closed:
            return
        b64 = base64.b64encode(pcm16_24k).decode("ascii")
        await self._send({"type": "input_audio_buffer.append", "audio": b64})

    async def disconnect(self) -> None:
        self._closed = True
        if self._recv_task and not self._recv_task.done():
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
        logger.info("oai_bridge_disconnected", call_sid=self.session.call_sid)

    async def _send(self, event: dict[str, Any]) -> None:
        if self._ws and not self._closed:
            await self._ws.send(json.dumps(event))

    async def _receive_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    event = json.loads(raw)
                    await self._handle_event(event)
                except Exception as exc:
                    logger.exception(
                        "oai_event_handler_error",
                        error=str(exc),
                        call_sid=self.session.call_sid,
                    )
        except ConnectionClosed:
            logger.info("oai_ws_closed", call_sid=self.session.call_sid)
        except Exception as exc:
            logger.exception("oai_receive_loop_error", error=str(exc))

    async def _handle_event(self, event: dict[str, Any]) -> None:
        etype = event.get("type", "")

        if etype == "response.audio.delta":
            # Audio from OpenAI → downsample → mulaw → Twilio
            try:
                audio_b64 = event["delta"]
                pcm_24k = base64.b64decode(audio_b64)
                # Ensure even byte count (audioop requires 2-byte aligned samples)
                if len(pcm_24k) % 2 != 0:
                    pcm_24k = pcm_24k[: len(pcm_24k) - 1]
                if not pcm_24k:
                    return
                pcm_8k = resample_pcm16(pcm_24k, from_rate=24000, to_rate=8000)
                mulaw = pcm16_to_mulaw(pcm_8k)
                payload = base64.b64encode(mulaw).decode("ascii")
                await self.session.twilio_ws.send_text(json.dumps({
                    "event": "media",
                    "streamSid": self.session.stream_sid,
                    "media": {"payload": payload},
                }))
            except Exception as exc:
                # If Twilio WS is already closed (patient hung up) this fires every delta.
                # Only warn once per call to avoid log flooding.
                logger.warning(
                    "twilio_audio_send_failed",
                    error=str(exc),
                    call_sid=self.session.call_sid,
                )

        elif etype == "conversation.item.input_audio_transcription.completed":
            content = event.get("transcript", "")
            if content.strip():
                await transcript_service.enqueue(
                    call_id=self.session.db_call_id,
                    role=TranscriptRole.PATIENT,
                    content=content,
                )
                await dashboard_ws.emit_transcript({
                    "callSid": self.session.call_sid,
                    "role": "patient",
                    "content": content,
                })

        elif etype == "response.audio_transcript.done":
            content = event.get("transcript", "")
            if content.strip():
                await transcript_service.enqueue(
                    call_id=self.session.db_call_id,
                    role=TranscriptRole.AGENT,
                    content=content,
                    agent_name=self.session.current_agent,
                )
                await dashboard_ws.emit_transcript({
                    "callSid": self.session.call_sid,
                    "role": "agent",
                    "content": content,
                    "agentName": self.session.current_agent,
                })

        elif etype == "response.function_call_arguments.done":
            name = event.get("name", "")
            args_json = event.get("arguments", "{}")
            call_id = event.get("call_id", "")
            try:
                args = json.loads(args_json)
            except json.JSONDecodeError:
                args = {}

            logger.info(
                "oai_tool_call",
                name=name,
                call_sid=self.session.call_sid,
                agent=self.session.current_agent,
            )
            result = await self._on_tool_call(name, args) or {"status": "ok"}

            # Send the result back to OAI as a function_call_output item
            await self._send({
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(result),
                },
            })
            await self._send({"type": "response.create"})

        elif etype == "error":
            logger.error(
                "oai_error_event",
                error=event.get("error"),
                call_sid=self.session.call_sid,
            )

        elif etype in ("response.done", "session.created", "session.updated"):
            logger.debug("oai_event", type=etype, call_sid=self.session.call_sid)
