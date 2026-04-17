"""FastAPI application entry point with Socket.IO ASGI mounting."""
from contextlib import asynccontextmanager

import socketio
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analytics, appointments, calls, doctors, patients, webhooks
from app.api.auth import router as auth_router
from app.api.vapi_webhook import router as vapi_router
from app.api.settings import router as settings_router
from app.auth import require_auth
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services import settings_svc
from app.services.qdrant_svc import close_client, ensure_collections
from app.services.transcript_svc import transcript_service
from app.utils.logger import configure_logging, get_logger
from app.websocket import twilio_stream
from app.websocket.dashboard_ws import sio

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("app_startup", environment=get_settings().environment)
    transcript_service.start()
    # Load DB-stored credential overrides into memory
    try:
        async with AsyncSessionLocal() as session:
            await settings_svc.load_from_db(session)
    except Exception as exc:
        logger.warning("settings_load_failed", error=str(exc))
    await ensure_collections()
    yield
    await close_client()
    await transcript_service.stop()
    logger.info("app_shutdown")


fastapi_app = FastAPI(
    title="MediCall AI",
    description="Real-time AI voice agent for medical workflows",
    version="0.1.0",
    lifespan=lifespan,
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Public routers (hit by Twilio/Vapi — they use their own signature auth) ──
fastapi_app.include_router(webhooks.router)         # /twilio/incoming, /twilio/outbound-twiml
fastapi_app.include_router(twilio_stream.router)    # WS /media-stream
fastapi_app.include_router(vapi_router)             # /api/vapi/webhook, /api/vapi/tool-call
fastapi_app.include_router(auth_router)             # /api/auth/status (public), /api/auth/verify (protected internally)

# ── Protected routers (require Authorization: Bearer <DASHBOARD_API_TOKEN>) ──
_api_auth = [Depends(require_auth)]
fastapi_app.include_router(calls.router, dependencies=_api_auth)
fastapi_app.include_router(patients.router, dependencies=_api_auth)
fastapi_app.include_router(doctors.router, dependencies=_api_auth)
fastapi_app.include_router(appointments.router, dependencies=_api_auth)
fastapi_app.include_router(analytics.router, dependencies=_api_auth)
fastapi_app.include_router(settings_router, dependencies=_api_auth)


@fastapi_app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@fastapi_app.get("/api/health/deep")
async def deep_health() -> dict:
    """Pre-demo smoke test — pings every external dependency in parallel.

    Public endpoint (no auth) so it can be hit from a curl one-liner before
    the demo. Each service returns a status string and an error message if
    the call failed. Total budget < 3 seconds; individual probes time out
    aggressively so a stalled provider doesn't hang the whole report.
    """
    import asyncio
    import httpx

    from app.services.settings_svc import get_effective

    async def probe_openai() -> tuple[str, str]:
        key = get_effective("openai_api_key")
        if not key:
            return ("unset", "OPENAI_API_KEY not configured")
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
            return ("ok", "") if r.status_code == 200 else ("error", f"HTTP {r.status_code}")
        except Exception as exc:
            return ("error", str(exc)[:120])

    async def probe_twilio() -> tuple[str, str]:
        sid = get_effective("twilio_account_sid")
        tok = get_effective("twilio_auth_token")
        if not sid or not tok:
            return ("unset", "Twilio credentials not configured")
        try:
            async with httpx.AsyncClient(timeout=3.0, auth=(sid, tok)) as c:
                r = await c.get(f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json")
            return ("ok", "") if r.status_code == 200 else ("error", f"HTTP {r.status_code}")
        except Exception as exc:
            return ("error", str(exc)[:120])

    async def probe_qdrant() -> tuple[str, str]:
        url = get_effective("qdrant_url")
        if not url:
            return ("unset", "QDRANT_URL not configured")
        try:
            from app.services import qdrant_svc

            client = qdrant_svc.get_client()
            await client.get_collections()
            return ("ok", "")
        except Exception as exc:
            return ("error", str(exc)[:120])

    async def probe_db() -> tuple[str, str]:
        try:
            from sqlalchemy import text

            async with AsyncSessionLocal() as session:
                await session.execute(text("SELECT 1"))
            return ("ok", "")
        except Exception as exc:
            return ("error", str(exc)[:120])

    openai_r, twilio_r, qdrant_r, db_r = await asyncio.gather(
        probe_openai(), probe_twilio(), probe_qdrant(), probe_db(),
        return_exceptions=False,
    )

    services = {
        "openai":   {"status": openai_r[0], "error": openai_r[1] or None},
        "twilio":   {"status": twilio_r[0], "error": twilio_r[1] or None},
        "qdrant":   {"status": qdrant_r[0], "error": qdrant_r[1] or None},
        "database": {"status": db_r[0],     "error": db_r[1]     or None},
    }
    overall = "ok" if all(s["status"] == "ok" for s in services.values()) else "degraded"
    return {"overall": overall, "services": services}


# Mount Socket.IO as ASGI middleware — this is the actual `app` exposed to uvicorn
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")
