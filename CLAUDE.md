# MediCall AI

Real-time AI voice agent for a medical clinic. Patients call a phone number (Twilio) or a browser widget (Vapi); their audio is bridged to OpenAI's Realtime API; a multi-agent system (Triage → Scheduling / Medication / Emergency) handles the conversation; calls are persisted to Postgres; staff monitor everything live via a React dashboard.

---

## Architecture (skim first)

```
Caller ──► Twilio Media Stream  ──┐
Browser ──► Vapi WebRTC ──────────┤
                                  ▼
                         FastAPI (async)  ◄──► OpenAI Realtime WS
                          │   │   │
                          │   │   └──► Qdrant (3 collections)
                          │   └──► PostgreSQL (patients, calls, …)
                          └──► Socket.IO /dashboard  ──► React UI
```

**Two parallel voice paths share the same agents/tools:**
- **Twilio** (prod): `POST /twilio/incoming` → WS `/media-stream` → [`openai_bridge.py`](backend/app/websocket/openai_bridge.py). Audio is raw mulaw 8 kHz ↔ PCM 24 kHz; resampling uses `audioop.ratecv` (never scipy — see Gotchas).
- **Vapi** (demo): `POST /api/vapi/webhook` for lifecycle + `POST /api/vapi/tool-call` for function dispatch. Assistant config built in [`vapi_session_svc.py`](backend/app/services/vapi_session_svc.py).

**Post-call pipeline** (fire-and-forget background task):
`generate_summary()` → `_consolidate_memory()` (Qdrant) → `send_post_call_sms()` → `push_call_summary()` (Sheets, optional)

---

## Directory Layout

```
backend/
  app/
    main.py              FastAPI entry + Socket.IO ASGI mount + lifespan
    config.py            pydantic-settings Settings + @lru_cache get_settings()
    database.py          AsyncSessionLocal, get_db, db_session context mgr
    api/                 REST routers (patients, calls, doctors, appointments,
                         analytics, webhooks, vapi_webhook, settings)
    agents/              BaseAgent + triage / scheduling / medication / emergency
                         + router.py (agent registry)
    services/
      call_manager.py       in-memory CallSession registry
      transcript_svc.py     batched async DB writer (asyncio.Queue)
      summary_svc.py        GPT-4o-mini post-call summary
      memory_svc.py         extract facts → Qdrant upsert
      qdrant_svc.py         3 collections, _qdrant_available flag
      vapi_session_svc.py   builds Vapi assistant JSON
      notification_svc.py   Twilio SMS
      sheets_sync.py        Google Sheets export (optional)
      settings_svc.py       DB-override-for-.env overlay cache
    websocket/
      twilio_stream.py      Twilio media stream handler
      openai_bridge.py      OpenAI Realtime WS client
      dashboard_ws.py       Socket.IO /dashboard namespace
    models/                SQLAlchemy 2.0 models (Mapped[] API)
    schemas/               Pydantic request/response schemas
  alembic/versions/        migrations
  scripts/seed_qdrant.py   seed medical_knowledge collection

dashboard/
  src/
    pages/                 one file per route (Dashboard, Patients, Calls, …,
                           Settings, Docs, DemoCall)
    components/            shared UI (Layout, Docs, active call cards, …)
    store/                 Redux Toolkit slices (call, ui)
    hooks/useSocket.ts     Socket.IO subscription → Redux dispatch
    lib/api.ts             axios instance
    lib/format.ts          date/duration/phone masking helpers
    content/docs/*.md      markdown for /docs route (imported via ?raw)
```

---

## Common Commands

```bash
# Full stack (backend + postgres + ngrok)
docker compose up -d

# Backend only (venv)
cd backend && uvicorn app.main:app --reload --port 8000

# Dashboard
cd dashboard && npm run dev

# DB migration
cd backend && alembic upgrade head
cd backend && alembic revision --autogenerate -m "describe change"

# Seed Qdrant (idempotent; skips if qdrant unavailable)
cd backend && python scripts/seed_qdrant.py

# Typecheck + build dashboard
cd dashboard && npm run build

# Tests
cd backend && pytest
```

---

## Conventions

- **Async everywhere** — never put blocking IO on the voice hot path. Use `asyncio.create_task()` for fire-and-forget, and keep references in a set (not a local variable) to avoid GC.
- **Settings access** — for code that needs credentials configurable at runtime, use `settings_svc.get_effective("key")`, not `get_settings().key`. DB values override `.env`.
- **DB sessions** — inside `async with db_session() as s:` **capture plain values (uuid, str) before the block ends**. Accessing ORM-attached attributes after session close raises `DetachedInstanceError`.
- **Models** — SQLAlchemy 2.0 `Mapped[]` style only. UUID primary keys. Timestamps with `server_default=func.now()` + `onupdate=func.now()`.
- **Agent system prompts** — must include `"Always respond in English, regardless of the language the caller uses."` (Hindi auto-detection otherwise.)
- **Transcript handling** — filter `transcriptType === "final"` before appending. Partial Deepgram updates are noise.
- **Error handling** — for optional integrations (Qdrant, Sheets, Vapi outbound), degrade gracefully. Log + continue; never 500 the caller.
- **No Claude/Anthropic mentions in commits** — git history is kept clean for public presentation.

---

## Critical Gotchas (battle-tested)

| Symptom | Root cause | Fix |
|---|---|---|
| Caller hears silence despite transcripts showing AI spoke | `scipy.signal.resample_poly` returns float64, `.astype("<i2")` corrupts | Use `audioop.ratecv` (integer-only resample) |
| "Meeting has ended" on Vapi demo | `systemPrompt` field or `playht` voice | Use `messages: [{role: "system", …}]` + `11labs/burt` |
| AI replies in Spanish/Hindi | No language directive | Add "Always respond in English" to every agent |
| Duplicate transcript rows | Deepgram partials being appended | Filter on `transcriptType === "final"` |
| `DetachedInstanceError` in post-call pipeline | Accessing `call.patient_id` after session closed | Capture `patient_id = call.patient_id` inside the block |
| `audioop` import fails on Python 3.13 | Removed from stdlib | `audioop-lts` package (already in requirements) |
| Qdrant `search()` deprecation warning | v1.10+ prefers `query_points()` | We pin `>=1.9.0,<2.0.0` |
| Background task disappears | Task GC'd while running | Hold reference in `_background_tasks: set`, discard on done |

---

## External Services — where their clients live

| Service | Client/File | Configured by |
|---|---|---|
| OpenAI Realtime | [`websocket/openai_bridge.py`](backend/app/websocket/openai_bridge.py) | `openai_api_key`, `openai_realtime_model` |
| OpenAI (summary/embed) | [`services/summary_svc.py`](backend/app/services/summary_svc.py), [`services/qdrant_svc.py`](backend/app/services/qdrant_svc.py) | `openai_api_key`, `post_call_summary_model` |
| Twilio (REST + webhook) | [`api/webhooks.py`](backend/app/api/webhooks.py), [`services/notification_svc.py`](backend/app/services/notification_svc.py) | `twilio_*` vars |
| Vapi | [`api/vapi_webhook.py`](backend/app/api/vapi_webhook.py), [`services/vapi_session_svc.py`](backend/app/services/vapi_session_svc.py) | `vapi_api_key`, `vapi_phone_number_id`, `public_url` |
| Qdrant | [`services/qdrant_svc.py`](backend/app/services/qdrant_svc.py) | `qdrant_url`, `qdrant_api_key` |
| Google Sheets | [`services/sheets_sync.py`](backend/app/services/sheets_sync.py) | `google_sheets_*` (optional) |

All keys can be set via **Settings UI** (stored in `app_settings` table) OR `.env` (fallback). DB takes precedence.

---

## How to: Common Tasks

**Add a new agent:**
1. Create `backend/app/agents/<name>.py` extending `BaseAgent`
2. Implement `get_system_prompt()`, `get_tools()`, `handle_tool_call()`
3. Register in `agents/router.py`'s `_agent_registry`
4. Add `{"agent_name": "<name>"}` to an existing agent's `route_to_agent` tool enum

**Add a new API endpoint:**
1. Create router in `backend/app/api/<name>.py`
2. `fastapi_app.include_router(...)` in [`main.py`](backend/app/main.py)
3. Pydantic schemas in `backend/app/schemas/<name>.py`

**Add a new DB model:**
1. Create `backend/app/models/<name>.py` (SQLAlchemy `Mapped[]` style)
2. Export from `backend/app/models/__init__.py`
3. `alembic revision --autogenerate -m "add <name>"` → review → `alembic upgrade head`

**Add a new credential field to Settings UI:**
1. Add field to `Settings` class in [`config.py`](backend/app/config.py)
2. Add key to `ALL_KEYS` list in [`api/settings.py`](backend/app/api/settings.py); mark secret in `_SECRET_KEYS` if sensitive
3. Add to `CREDENTIAL_GROUPS` in [`dashboard/src/pages/Settings.tsx`](dashboard/src/pages/Settings.tsx)
4. Read via `settings_svc.get_effective("<key>")` in backend code

---

## Not in scope / intentionally avoided

- **HIPAA compliance** — this is a hackathon demo, not production medical software. Encryption at rest, audit logs, and BAAs would be needed for real deployment.
- **Multi-tenant** — single clinic only. No per-clinic config.
- **Human handoff** — no warm transfer to a real receptionist.
- **Prescription writing** — explicitly forbidden in Medication agent prompt.

---

## When in doubt

- `/docs` route in the running dashboard has comprehensive interview-ready documentation (21 sections including request lifecycle, design decisions, debugging stories, FAQs, and interview Q&A).
- Read [`08-services-layer.md`](dashboard/src/content/docs/08-services-layer.md) and [`04-request-lifecycle.md`](dashboard/src/content/docs/04-request-lifecycle.md) for deeper context.
