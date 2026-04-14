# Configuration & Deployment

How to run MediCall AI locally and what env vars are needed.

## Environment Variables

All settings load from `.env` via `pydantic-settings` (`backend/app/config.py`). Missing optional vars degrade features gracefully — only the **required** vars are non-negotiable.

### Required

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql+asyncpg://medicall:medicall@postgres:5432/medicall` | Async PostgreSQL connection string |
| `OPENAI_API_KEY` | `sk-...` | OpenAI Realtime + Chat Completions + Embeddings |
| `OPENAI_REALTIME_MODEL` | `gpt-4o-realtime-preview` | Voice model identifier |
| `TWILIO_ACCOUNT_SID` | `AC...` | Twilio account |
| `TWILIO_AUTH_TOKEN` | (secret) | Used for both REST API and webhook signature validation |
| `TWILIO_PHONE_NUMBER` | `+1234567890` | The number patients call |
| `TWILIO_WEBHOOK_URL` | `https://abc.ngrok.io/twilio/incoming` | Where Twilio sends incoming-call webhooks |

### Optional (graceful degradation)

| Variable | Used By | Effect if Missing |
|----------|---------|-------------------|
| `QDRANT_URL` | Qdrant client | Memory features become no-ops |
| `QDRANT_API_KEY` | Qdrant auth | Required for cloud Qdrant; local can run unauthenticated |
| `VAPI_API_KEY` | Vapi outbound + webhook | Vapi path disabled |
| `VAPI_PHONE_NUMBER_ID` | Vapi outbound | Outbound reminder calls disabled |
| `PUBLIC_URL` | Vapi assistant config | `serverUrl` for tool calls falls back to placeholder |
| `ONCALL_PHONE_NUMBER` | EmergencyAgent | Emergency SMS alerts disabled |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | sheets_sync | Sheets export silently no-ops |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | sheets_sync | Same |
| `APP_HOST` | uvicorn | Defaults to `0.0.0.0` |
| `APP_PORT` | uvicorn | Defaults to `8000` |
| `LOG_LEVEL` | structlog | Defaults to `INFO` |
| `ENVIRONMENT` | tags + log enrichment | Defaults to `development` |

## Local Development

```bash
# 1. Clone and create .env
git clone <repo> medicall-ai
cd medicall-ai
cp .env.example backend/.env
# Edit backend/.env with your API keys

# 2. Bring up the stack
docker compose up -d

# 3. Run migrations
docker compose exec backend alembic upgrade head

# 4. (Optional) Seed Qdrant medical knowledge
docker compose exec backend python scripts/seed_qdrant.py

# 5. Frontend dev server
cd dashboard
npm install
npm run dev
```

The stack includes:
- **postgres** — PostgreSQL 16 with persistent volume
- **backend** — FastAPI/uvicorn with hot reload mounted from `./backend`
- **ngrok** — exposes the backend on a public HTTPS URL for Twilio/Vapi webhooks

## ngrok and Webhook URLs

Twilio and Vapi need to reach our local backend over HTTPS. ngrok creates a public URL like `https://abc123.ngrok.io` that forwards to `localhost:8000`. After bringing up the stack:

```bash
docker compose logs ngrok | grep -i "https://"
```

Copy the URL into:
1. `backend/.env` — `TWILIO_WEBHOOK_URL=https://abc123.ngrok.io/twilio/incoming` and `PUBLIC_URL=https://abc123.ngrok.io`
2. **Twilio Console** → Phone Numbers → Active Numbers → set Voice URL to the same
3. **Vapi Dashboard** → Settings → serverUrl → `https://abc123.ngrok.io/api/vapi/webhook`

ngrok URLs change every restart unless you have a paid account with reserved domains.

## Alembic Migrations

```bash
# Apply pending migrations
docker compose exec backend alembic upgrade head

# Generate a new migration after model changes
docker compose exec backend alembic revision --autogenerate -m "add new column"

# Rollback last migration
docker compose exec backend alembic downgrade -1
```

Migration files live in `backend/alembic/versions/`.

## Production Considerations (Not Yet Implemented)

This is a demo build. For production you'd want:
- **Auth middleware** on all `/api/*` routes (JWT or API key)
- **HTTPS termination** at a load balancer (Caddy / Nginx / Traefik)
- **Multi-worker uvicorn** or gunicorn — but you'd need sticky sessions for the WebSocket since CallSession is in-memory per worker
- **Redis** for session sharing across workers
- **Sentry / Datadog** for error tracking
- **Database backups** scheduled
- **Secrets manager** instead of `.env` (AWS Secrets Manager, HashiCorp Vault)
- **HIPAA-compliant infrastructure** if storing real patient data — encrypted volumes, audit logs, BAAs with vendors
