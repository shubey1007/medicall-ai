# MediCall AI — Hackathon Submission

**Tagline:** Always-on AI voice agent for medical clinics — answers calls,
triages symptoms, books appointments, escalates emergencies, in any language.

---

## The problem

Clinics get hundreds of routine calls per day. Patients wait on hold,
staff burn out, after-hours calls go unanswered, and English-only
receptionists can't serve multilingual patients. Hiring more staff
doesn't scale.

## The solution

A voice AI that picks up every call instantly, runs the whole conversation
through a multi-agent system specialized for medical workflows, persists
everything to Postgres, and gives staff a real-time dashboard to monitor
and intervene.

## What's in the box

- **Two voice paths**, same backend:
  - Twilio Media Streams for real phone numbers (production)
  - Vapi WebRTC for browser-based demos (no phone needed)
- **OpenAI Realtime API** for one-WebSocket STT + LLM + TTS (sub-second latency)
- **Multi-agent system** — Triage → Scheduling / Medication / Emergency,
  with mid-call hand-off via OpenAI `session.update`
- **Qdrant vector memory** — three collections (patient memory, medical
  knowledge RAG, doctor directory). Patients don't repeat their history.
- **Real-time dashboard** — React + Redux + Socket.IO. Live transcripts,
  active call cards, analytics
- **Post-call pipeline** — GPT-4o-mini summary → Qdrant memory consolidation
  → Twilio SMS → optional Google Sheets export
- **Production-ready** — JWT-gated dashboard, Twilio signature validation,
  graceful degradation when optional services (Qdrant, Sheets) are down,
  DB-backed credentials configurable from a Settings UI

## Sponsor integrations

| Sponsor | Where it's used | Why it matters |
|---|---|---|
| **OpenAI** | Realtime API for live voice, GPT-4o-mini for post-call summaries, text-embedding-3-small for memory | One WebSocket replaces a stitched STT+LLM+TTS pipeline → 3× lower latency |
| **Twilio** | Inbound phone (Media Streams), outbound calls, SMS notifications, signature-validated webhooks | Battle-tested phone infra; the production path for real patients |
| **Vapi** | Browser WebRTC demo, multilingual Deepgram transcription, outbound appointment reminders | Lets judges call the AI without a phone; serverUrl webhook reuses our agent backend |
| **Qdrant** | Semantic patient memory, medical knowledge RAG, doctor directory lookup | "Chest pain" matches "MI symptoms" — keyword search can't do that |

## Architecture (one paragraph)

A FastAPI async monolith mounts a Socket.IO ASGI server alongside the
HTTP routes. Inbound Twilio calls open a Media Stream WebSocket;
[`openai_bridge.py`](../backend/app/websocket/openai_bridge.py) mu-law-decodes,
upsamples to 24kHz PCM, forwards to OpenAI Realtime, and reverses the
chain on the way back — all async, no scipy (it corrupted audio; we use
`audioop.ratecv`). A multi-agent router swaps the active agent's
system prompt and tools mid-call via `session.update`. Function calls
flow back through the bridge, get dispatched to per-agent handlers,
and the result is sent as a `function_call_output` item. Transcripts
are batched into Postgres via an `asyncio.Queue`. Post-call, a
fire-and-forget pipeline generates the summary, extracts up to 5 key
medical facts into Qdrant `patient_memory`, sends a Twilio SMS, and
optionally pushes to Google Sheets. Staff see everything live via
Socket.IO + Redux Toolkit.

## Try it

```bash
git clone <repo>
cd medicall-ai
cp .env.example .env  # fill in OPENAI_API_KEY, TWILIO_*, etc.
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python scripts/seed_qdrant.py  # seeds medical knowledge
# Dashboard:  http://localhost:5173
# API docs:   http://localhost:8000/docs
# Live demo:  http://localhost:5173/demo  (browser, no phone)
```

## What's intentionally out of scope

- **HIPAA compliance** — encryption at rest, audit logs, BAAs are needed
  before real patient data
- **Multi-tenant** — single clinic per deployment
- **Human handoff** — no warm transfer to a real receptionist
- **Prescription writing** — explicitly forbidden in the Medication agent prompt

## Links

- **Live demo:** *(your ngrok URL)*
- **Repo:** *(your GitHub URL)*
- **Full docs:** `/docs` route in the running dashboard — 21 sections covering
  architecture, request lifecycle, design decisions, debugging stories,
  FAQs, and 30+ interview Q&A at three difficulty levels
- **Architecture:** see [03-architecture.md](../dashboard/src/content/docs/03-architecture.md)
- **Demo runbook:** see [DEMO.md](DEMO.md)

## Contact

Shubham Singh Tomar · shubhsingtam10@gmail.com
