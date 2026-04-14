"""FastAPI application entry point with Socket.IO ASGI mounting."""
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analytics, appointments, calls, doctors, patients, webhooks
from app.config import get_settings
from app.services.qdrant_svc import ensure_collections
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
    await ensure_collections()
    yield
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

# Routers
fastapi_app.include_router(webhooks.router)
fastapi_app.include_router(twilio_stream.router)
fastapi_app.include_router(calls.router)
fastapi_app.include_router(patients.router)
fastapi_app.include_router(doctors.router)
fastapi_app.include_router(appointments.router)
fastapi_app.include_router(analytics.router)


@fastapi_app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Mount Socket.IO as ASGI middleware — this is the actual `app` exposed to uvicorn
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")
