# API Reference

Every REST endpoint and WebSocket exposed by the MediCall AI backend.

## Patients

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/patients` | List patients with optional `?search=` filter and pagination (`page`, `page_size`) |
| POST | `/api/patients` | Create a new patient (`phone`, optional `name` + `medical_context`) |
| GET | `/api/patients/{id}` | Get a single patient by UUID |
| PUT | `/api/patients/{id}` | Update patient name or medical_context |
| DELETE | `/api/patients/{id}` | Delete patient (cascades to all calls and appointments) |

## Doctors

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/doctors` | List doctors with optional search |
| POST | `/api/doctors` | Create a new doctor (also fires async Qdrant upsert for semantic search) |
| GET | `/api/doctors/{id}` | Get a single doctor |
| PUT | `/api/doctors/{id}` | Update doctor (re-syncs to Qdrant) |
| DELETE | `/api/doctors/{id}` | Delete a doctor record |

## Calls

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/calls/initiate` | Place an outbound Twilio call to a phone number |
| GET | `/api/calls` | Paginated list of calls (joined with patient name and urgency_level from summary) |
| GET | `/api/calls/{id}` | Get a single call with metadata |
| GET | `/api/calls/{id}/transcript` | Fetch the full ordered transcript for a call |

## Appointments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/appointments` | List appointments, optionally filtered by `?patient_id=` |
| POST | `/api/appointments` | Create an appointment (`patient_id`, `doctor_name`, `scheduled_at`, optional `notes`) |
| PUT | `/api/appointments/{id}` | Update appointment fields or status |
| DELETE | `/api/appointments/{id}` | Cancel an appointment (sets status=CANCELLED) |
| POST | `/api/appointments/{id}/remind` | Trigger an outbound Vapi reminder call to the patient |

## Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary` | Aggregate stats: total calls, avg duration, urgency distribution |
| GET | `/api/analytics/agents` | Agent usage breakdown (which agents are handling which calls) |

## Webhooks (External Callers)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/twilio/incoming` | Twilio webhook on incoming phone call → returns TwiML with `<Stream>` |
| POST | `/twilio/outbound-twiml` | TwiML used for outbound calls initiated via `/api/calls/initiate` |
| POST | `/api/vapi/webhook` | Vapi serverUrl webhook for lifecycle events (assistant-request, status-update, end-of-call-report) |
| POST | `/api/vapi/tool-call` | Vapi function-call dispatch to agent registry |

## WebSockets

| Path | Protocol | Description |
|------|----------|-------------|
| `/media-stream` | Twilio MediaStream | Bidirectional audio over WebSocket between Twilio and our backend |
| `/dashboard` | Socket.IO namespace | Real-time call events broadcast to dashboard clients |

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe; returns `{status: "ok"}` |

## Authentication

The current build is **demo-grade** — there is no authentication on the dashboard or REST API. For production, every `/api/*` route would need a JWT or API-key middleware, and the dashboard would require a login flow. The Twilio and Vapi webhooks are protected by signature verification (Twilio) and a shared secret (Vapi, optional but recommended).
