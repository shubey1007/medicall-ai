"""WebSocket endpoint for Twilio Media Streams.

Receives base64 mulaw 8kHz audio from Twilio, forwards pcm16 24kHz to OpenAI RT,
and streams OpenAI's audio responses back to Twilio.
"""
import asyncio
import base64
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import db_session
from app.services.settings_svc import get_effective
from app.models import Call, CallStatus, Patient, TranscriptRole
from app.models import TranscriptEntry
from app.services.call_manager import CallSession, call_manager
from app.services.memory_svc import consolidate as consolidate_memory
from app.services.notification_svc import send_post_call_sms
from app.services.sheets_sync import push_call_summary
from app.services.summary_svc import generate_summary
from app.services.transcript_svc import transcript_service
from app.utils.logger import get_logger, mask_phone
from app.websocket import dashboard_ws
from app.websocket.audio_utils import mulaw_to_pcm16, resample_pcm16

logger = get_logger(__name__)

_background_tasks: set[asyncio.Task] = set()

router = APIRouter()


@router.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    session: CallSession | None = None

    try:
        async for raw in websocket.iter_text():
            msg = json.loads(raw)
            event = msg.get("event")

            if event == "connected":
                logger.info("twilio_stream_connected")

            elif event == "start":
                start_data = msg.get("start") or {}
                params = start_data.get("customParameters") or {}

                call_sid = params.get("callSid") or start_data.get("callSid", "")
                stream_sid = start_data.get("streamSid", "")
                patient_phone = params.get("patientPhone", "")
                db_call_id_str = params.get("dbCallId", "")
                patient_id_str = params.get("patientId", "")

                if not (call_sid and stream_sid and db_call_id_str and patient_id_str):
                    logger.error(
                        "twilio_stream_bad_start",
                        has_call_sid=bool(call_sid),
                        has_stream_sid=bool(stream_sid),
                        has_db_call_id=bool(db_call_id_str),
                        has_patient_id=bool(patient_id_str),
                    )
                    if call_sid:
                        await _mark_call_failed(call_sid)
                    await websocket.close()
                    return

                try:
                    db_call_id = uuid.UUID(db_call_id_str)
                    patient_id = uuid.UUID(patient_id_str)
                except ValueError:
                    logger.error("twilio_stream_invalid_uuid", call_sid=call_sid)
                    await _mark_call_failed(call_sid)
                    await websocket.close()
                    return

                session = CallSession(
                    call_sid=call_sid,
                    stream_sid=stream_sid,
                    db_call_id=db_call_id,
                    patient_phone=patient_phone,
                    patient_id=patient_id,
                    twilio_ws=websocket,
                    patient_name=None,  # populated after DB load below
                )
                call_manager.register(session)

                async with db_session() as db:
                    result = await db.execute(
                        select(Call)
                        .options(selectinload(Call.patient))
                        .where(Call.id == db_call_id)
                    )
                    call = result.scalar_one()
                    call.status = CallStatus.ACTIVE
                    patient_name: str | None = call.patient.name if call.patient else None
                    await db.commit()

                session.patient_name = patient_name

                # Lazy imports so app startup doesn't depend on Phase 4 router/agents.
                from app.agents.router import agent_router  # Phase 4
                from app.websocket.openai_bridge import OpenAIRealtimeBridge

                active_session = session  # narrow for closure (non-Optional)

                # Tool-call handler: dispatch to current agent, handle routing.
                async def handle_tool_call(name: str, args: dict) -> dict:
                    try:
                        current = agent_router.get(active_session.current_agent)
                    except KeyError:
                        logger.error(
                            "unknown_current_agent",
                            agent=active_session.current_agent,
                            call_sid=active_session.call_sid,
                        )
                        return {"status": "error", "message": "Internal routing error"}

                    result = await current.handle_tool_call(name, args, active_session)

                    target = current.should_route(name, args, result)
                    if target and target != active_session.current_agent:
                        try:
                            new_agent = agent_router.get(target)
                        except KeyError:
                            logger.error(
                                "unknown_routing_target",
                                target=target,
                                call_sid=active_session.call_sid,
                            )
                            # Leave current_agent unchanged — don't wedge the call
                            return result

                        prev = active_session.current_agent
                        active_session.current_agent = target
                        call_manager.set_agent(active_session.call_sid, target)
                        if active_session.openai_bridge is not None:
                            await active_session.openai_bridge.update_session(new_agent)
                        await dashboard_ws.emit_agent_changed({
                            "callSid": active_session.call_sid,
                            "fromAgent": prev,
                            "toAgent": target,
                        })
                        await transcript_service.enqueue(
                            call_id=active_session.db_call_id,
                            role=TranscriptRole.SYSTEM,
                            content=f"Routed from {prev} to {target}",
                        )

                    if result and result.get("action") == "end_call":
                        call_sid = active_session.call_sid

                        async def _delayed_hangup(_sid: str = call_sid) -> None:
                            await asyncio.sleep(6)
                            try:
                                from twilio.rest import Client as TwilioClient

                                def _hang() -> None:
                                    TwilioClient(
                                        get_effective("twilio_account_sid"),
                                        get_effective("twilio_auth_token"),
                                    ).calls(_sid).update(status="completed")

                                await asyncio.to_thread(_hang)
                                logger.info("call_hung_up_by_agent", call_sid=_sid)
                            except Exception as exc:
                                logger.warning("hangup_failed", error=str(exc), call_sid=_sid)

                        _task = asyncio.create_task(_delayed_hangup())
                        _background_tasks.add(_task)
                        _task.add_done_callback(_background_tasks.discard)

                    return result

                bridge = OpenAIRealtimeBridge(active_session, on_tool_call=handle_tool_call)
                active_session.openai_bridge = bridge
                initial_agent = agent_router.get("triage")
                await bridge.connect(initial_agent)

                await dashboard_ws.emit_call_started({
                    "callSid": call_sid,
                    "patientPhone": mask_phone(patient_phone),
                    "patientName": patient_name,
                    "agent": "triage",
                    "startedAt": session.started_at.isoformat(),
                })
                logger.info("twilio_stream_started", call_sid=call_sid, stream_sid=stream_sid)

            elif event == "media" and session is not None:
                payload_b64 = msg["media"]["payload"]
                mulaw = base64.b64decode(payload_b64)
                pcm_8k = mulaw_to_pcm16(mulaw)
                pcm_24k = resample_pcm16(pcm_8k, from_rate=8000, to_rate=24000)
                if session.openai_bridge is not None:
                    await session.openai_bridge.send_audio(pcm_24k)

            elif event == "stop":
                break

    except WebSocketDisconnect:
        logger.info(
            "twilio_stream_disconnected",
            call_sid=session.call_sid if session else None,
        )
    except Exception as exc:
        logger.exception("twilio_stream_error", error=str(exc))
    finally:
        if session is not None:
            await _finalize_call(session)


async def _mark_call_failed(call_sid: str) -> None:
    """Best-effort: mark a call row as FAILED when we cannot proceed."""
    try:
        async with db_session() as db:
            result = await db.execute(select(Call).where(Call.call_sid == call_sid))
            call = result.scalar_one_or_none()
            if call is not None and call.status != CallStatus.COMPLETED:
                call.status = CallStatus.FAILED
                await db.commit()
    except Exception as exc:
        logger.exception("mark_call_failed_error", error=str(exc), call_sid=call_sid)


async def _finalize_call(session: CallSession) -> None:
    """Close the OpenAI bridge, update DB, emit dashboard event. Idempotent."""
    if session.finalized:
        return
    session.finalized = True

    if session.openai_bridge:
        try:
            await session.openai_bridge.disconnect()
        except Exception as exc:
            logger.exception(
                "bridge_disconnect_error",
                error=str(exc),
                call_sid=session.call_sid,
            )

    ended_at = datetime.now(timezone.utc)
    duration = int((ended_at - session.started_at).total_seconds())

    try:
        async with db_session() as db:
            result = await db.execute(select(Call).where(Call.id == session.db_call_id))
            call = result.scalar_one()
            call.status = CallStatus.COMPLETED
            call.ended_at = ended_at
            call.duration_seconds = duration
            await db.commit()
    except Exception as exc:
        logger.exception(
            "finalize_db_update_error",
            error=str(exc),
            call_sid=session.call_sid,
        )

    await dashboard_ws.emit_call_ended({
        "callSid": session.call_sid,
        "duration": duration,
    })
    call_manager.end(session.call_sid)

    # Post-call pipeline: fire-and-forget background tasks
    async def _post_call_pipeline() -> None:
        try:
            summary = await generate_summary(session.db_call_id)
            if summary is None:
                return

            # Memory consolidation: extract key facts from the full transcript
            # and upsert to Qdrant patient_memory. Isolated from the rest so
            # a Qdrant outage can't poison summary/sheets/SMS.
            try:
                async with db_session() as db:
                    rows = await db.execute(
                        select(TranscriptEntry)
                        .where(TranscriptEntry.call_id == session.db_call_id)
                        .order_by(TranscriptEntry.timestamp.asc())
                    )
                    entries = rows.scalars().all()
                    transcript_text = "\n".join(
                        f"{e.role.value if hasattr(e.role, 'value') else e.role}: {e.content}"
                        for e in entries
                    )
                if transcript_text.strip():
                    await consolidate_memory(
                        patient_id=session.patient_id,
                        call_id=session.db_call_id,
                        transcript_text=transcript_text,
                    )
            except Exception as exc:
                logger.exception(
                    "memory_consolidate_failed",
                    error=str(exc),
                    call_sid=session.call_sid,
                )

            await push_call_summary(session.db_call_id)
            if session.patient_phone:
                await send_post_call_sms(session.patient_phone, summary)
        except Exception as exc:
            logger.exception(
                "post_call_pipeline_failed",
                error=str(exc),
                call_sid=session.call_sid,
            )

    task = asyncio.create_task(_post_call_pipeline())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
