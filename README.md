# MediCall AI

Real-time AI voice agent for medical workflows. Patients call a phone number, speak
with an AI agent powered by OpenAI's Real-Time API, get routed to specialized
medical sub-agents, and everything is persisted to PostgreSQL with live admin
monitoring via a React dashboard.

## Architecture

```
Twilio ──► ngrok ──► FastAPI :8000 ──► OpenAI Realtime API (WSS)
                          │
                          ├─► PostgreSQL 16
                          │
                          └─► Socket.IO ──► React Dashboard :5173
```

### Components

- **Backend** (Python 3.11 + FastAPI): REST API, Twilio webhook, WebSocket media stream,
  OpenAI Realtime API bridge, multi-agent router, async SQLAlchemy.
- **Dashboard** (React 18 + Vite): Redux Toolkit, Socket.IO client, Tailwind, Recharts.
- **Database** (PostgreSQL 16): patients, calls, transcript_entries, appointments, call_summaries.
- **Infrastructure** (Docker Compose): single-command local development.

### Agents

- **TriageAgent** — initial greeting, symptom collection, urgency assessment, routing
- **SchedulingAgent** — book/reschedule/cancel appointments
- **MedicationAgent** — general medication information (no prescriptions)
- **EmergencyAgent** — critical escalation, SMS alerts to on-call staff

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A Twilio account with a phone number
- An OpenAI API key with `gpt-4o-realtime-preview` access
- [ngrok](https://ngrok.com) account (free tier works) for exposing the local backend to Twilio

Optional:
- Google Cloud service account with Sheets API (for call log sync)

## Setup

### 1. Clone and configure environment

```bash
git clone <repo>
cd medicall-ai
cp .env.example .env
```

Edit `.env` and set:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `ONCALL_PHONE_NUMBER` (your own number for testing emergency alerts)
- Leave `TWILIO_WEBHOOK_URL` empty for now — we'll set it after starting ngrok.

### 2. Start the stack

```bash
docker compose up -d postgres
cd backend && alembic upgrade head
python ../scripts/seed_db.py
cd ..
docker compose up -d backend dashboard
```

Verify:
- Backend: http://localhost:8000/health
- API docs: http://localhost:8000/docs
- Dashboard: http://localhost:5173

### 3. Expose backend to Twilio

In a separate terminal:

```bash
ngrok http 8000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) and:
1. Update `.env`: `TWILIO_WEBHOOK_URL=https://abc123.ngrok-free.app`
2. In the Twilio Console, configure your phone number's voice webhook:
   `https://abc123.ngrok-free.app/twilio/incoming` (HTTP POST)
3. Restart the backend: `docker compose restart backend`

### 4. Place a test call

Call your Twilio number. You should:
1. Hear "Connecting you to MediCall AI" then the AI greeting
2. Be able to converse naturally — say "I need to book an appointment"
3. Hear the agent hand off to SchedulingAgent
4. See the call appear live on the dashboard at http://localhost:5173
5. Expand the call card to see live transcript streaming
6. After hanging up, find the call in Call History with an AI-generated summary

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Async SQLAlchemy connection string |
| `TWILIO_ACCOUNT_SID` | yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | yes | Your Twilio number (E.164) |
| `TWILIO_WEBHOOK_URL` | yes | ngrok HTTPS URL for signature validation |
| `OPENAI_API_KEY` | yes | OpenAI API key |
| `OPENAI_REALTIME_MODEL` | no | Default: `gpt-4o-realtime-preview` |
| `POST_CALL_SUMMARY_MODEL` | no | Default: `gpt-4o-mini` |
| `ONCALL_PHONE_NUMBER` | no | SMS recipient for emergency escalations |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | no | Service account JSON (optional sync) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | no | Target sheet ID |

## API Reference

OpenAPI/Swagger UI is auto-generated at http://localhost:8000/docs.

Key endpoints:
- `GET /api/calls` — paginated call list with filters
- `GET /api/calls/{id}` — full call detail including transcript and summary
- `GET /api/patients` — patient list with search
- `GET /api/analytics/summary` — dashboard stats (urgency, duration, calls/day)
- `POST /twilio/incoming` — Twilio webhook (called by Twilio, not by clients)
- `WS /media-stream` — Twilio Media Stream WebSocket
- Socket.IO `/dashboard` namespace — real-time events

## Development Workflow

### Running tests

```bash
cd backend
pytest tests/ -v
pytest --cov=app tests/   # with coverage
```

### Database migrations

```bash
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

### Dashboard dev server

The dashboard runs with hot-reload inside Docker. Edit files in `dashboard/src/`
and changes reflect immediately. For debugging outside Docker:

```bash
cd dashboard
npm install
npm run dev
```

### Call simulation (no real phone needed)

```bash
python scripts/test_call.py
```

This connects to the local WebSocket and simulates the Twilio Media Stream protocol.

## Folder Structure

```
medicall-ai/
├── backend/           FastAPI application
│   ├── app/
│   │   ├── main.py         Entry + Socket.IO ASGI mount
│   │   ├── config.py       Pydantic settings
│   │   ├── database.py     Async SQLAlchemy
│   │   ├── models/         ORM models
│   │   ├── schemas/        Pydantic DTOs
│   │   ├── api/            REST + Twilio webhook
│   │   ├── websocket/      Media stream + OAI bridge
│   │   ├── agents/         Multi-agent system
│   │   ├── services/       Business logic
│   │   └── utils/          Logger
│   ├── alembic/       Migrations
│   └── tests/
├── dashboard/         React + Vite + Redux + Tailwind
│   └── src/
│       ├── pages/          Route pages
│       ├── components/     Shared UI
│       ├── store/          Redux slices
│       ├── hooks/          useSocket, etc.
│       └── lib/            api, socket, format
├── scripts/           seed_db.py, test_call.py
├── docs/              Design specs and implementation plans
├── docker-compose.yml
└── .env.example
```

## Troubleshooting

**"Invalid Twilio signature" errors** — Ensure `TWILIO_WEBHOOK_URL` matches your
ngrok URL exactly (including `https://`).

**No audio back from AI** — Check `OPENAI_API_KEY` has Realtime API access. Inspect
backend logs for `oai_bridge_connected` followed by `oai_session_configured`.

**Dashboard shows no live calls** — Open browser DevTools → Network → WS tab and
confirm the `/socket.io` connection is open. Check CORS settings in
`backend/app/main.py` match your dashboard URL.

**Post-call summary missing** — Summary generation runs as a background task. Check
backend logs for `summary_generated` or `summary_generation_failed`.

## Security Notes

- Twilio signature validation runs in production environment (`ENVIRONMENT=production`)
- Phone numbers are masked in logs as `+1 (XXX) XXX-1234`
- No PII appears in error messages
- All database operations use parameterized queries via SQLAlchemy ORM
- Tool calls from the LLM are validated against typed schemas before execution

## License

Internal / educational use. Not a medical device.
