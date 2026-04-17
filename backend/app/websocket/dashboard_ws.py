"""Socket.IO server + helpers to emit call events to the dashboard."""
from typing import Any

import socketio

from app.auth import auth_enabled, verify_token_value
from app.utils.logger import get_logger

logger = get_logger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
)

DASHBOARD_NS = "/dashboard"


@sio.event(namespace=DASHBOARD_NS)
async def connect(sid: str, environ: dict, auth: dict | None = None) -> None:
    """Reject the connection if auth is configured and the client didn't
    pass a valid token in the Socket.IO handshake `auth` payload.
    Frontend sends `{ token: "..." }` via the `auth` option of io().
    """
    if auth_enabled():
        token = (auth or {}).get("token") if isinstance(auth, dict) else None
        if not token or not verify_token_value(token):
            logger.warning("dashboard_connect_rejected", sid=sid, reason="invalid_token")
            # Returning False from a Socket.IO connect handler refuses the connection
            return False
    logger.info("dashboard_connected", sid=sid)
    return True


@sio.event(namespace=DASHBOARD_NS)
async def disconnect(sid: str) -> None:
    logger.info("dashboard_disconnected", sid=sid)


async def emit_call_started(payload: dict[str, Any]) -> None:
    await sio.emit("call:started", payload, namespace=DASHBOARD_NS)


async def emit_call_ended(payload: dict[str, Any]) -> None:
    await sio.emit("call:ended", payload, namespace=DASHBOARD_NS)


async def emit_agent_changed(payload: dict[str, Any]) -> None:
    await sio.emit("call:agent_changed", payload, namespace=DASHBOARD_NS)


async def emit_transcript(payload: dict[str, Any]) -> None:
    await sio.emit("call:transcript", payload, namespace=DASHBOARD_NS)
