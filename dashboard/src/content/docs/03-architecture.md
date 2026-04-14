# Architecture

High-level view of how MediCall AI pieces fit together.

## System Diagram

```
                                  ┌──────────────────┐
                                  │  Twilio Phone    │
                                  │      Number      │
                                  └────────┬─────────┘
                                           │ (1) Incoming call
                                           ▼
                              ┌────────────────────────┐
                              │ POST /twilio/incoming  │
                              │  (webhooks.py)         │
                              │  → Returns <Stream>    │
                              └────────────┬───────────┘
                                           │ (2) TwiML
                                           ▼
                              ┌────────────────────────┐          ┌──────────────┐
                              │ WS /media-stream       │◀────────▶│   OpenAI     │
                              │ (twilio_stream.py)     │          │   Realtime   │
                              │ ┌────────────────────┐ │          │     API      │
                              │ │ OpenAIRealtimeBridge│ │          └──────────────┘
                              │ │ (openai_bridge.py) │ │
                              │ └─────────┬──────────┘ │          ┌──────────────┐
                              └───────────┼────────────┘          │    Qdrant    │
                                          │                        │    Cloud     │
                                          ▼                        └──────▲───────┘
                              ┌────────────────────────┐                  │
                              │ Multi-Agent Router     │──────────────────┘
                              │ (TriageAgent, etc.)    │
                              └───────────┬────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   PostgreSQL DB        │
                              │ patients, calls,       │
                              │ transcripts, summaries │
                              └────────────────────────┘
```

## Component Responsibilities

- **`app/main.py`** — FastAPI app bootstrap; defines the `lifespan` context manager that starts `transcript_service` and calls `ensure_collections()` for Qdrant on startup, and closes the Qdrant client and stops the transcript queue on shutdown.
- **`app/api/`** — REST routers grouped by resource: `patients.py`, `doctors.py`, `calls.py`, `appointments.py`, `analytics.py`, `webhooks.py` (Twilio), and `vapi_webhook.py`. Each router is mounted under `/api/` with its own prefix.
- **`app/websocket/twilio_stream.py`** — Accepts Twilio MediaStream WebSockets; handles `start`, `media`, and `stop` events; owns the `OpenAIRealtimeBridge` lifecycle for the duration of each call.
- **`app/websocket/openai_bridge.py`** — Opens the OpenAI Realtime WebSocket, sends `session.update` with the current agent's system prompt and tool definitions, forwards audio chunks in both directions, and dispatches function-call results back to the agent system.
- **`app/websocket/audio_utils.py`** — Wraps `audioop-lts` for G.711 mu-law decode/encode and sample-rate conversion between Twilio's 8 kHz and OpenAI's 24 kHz PCM16.
- **`app/services/call_manager.py`** — In-memory registry of active `CallSession` objects keyed by `call_sid`. Lives in RAM for latency reasons — the hot audio path cannot afford a database lookup per audio chunk.
- **`app/agents/`** — `base.py` defines the `BaseAgent` interface with `get_system_prompt()`, `get_tools()`, and `handle_tool_call()`. Each of the four agents (`triage.py`, `scheduling.py`, `medication.py`, `emergency.py`) is a subclass that specialises these three methods.
- **`app/services/summary_svc.py`** — Post-call summary generator that sends the full transcript to `gpt-4o-mini` in JSON-mode and writes the structured result back to the `calls` table.
- **`app/services/memory_svc.py`** — Extracts up to five discrete medical facts from the transcript and upserts them into the Qdrant `patient_memory` collection so future calls can retrieve them via similarity search.
- **`app/services/qdrant_svc.py`** — Wraps `AsyncQdrantClient`, manages the three collections, and degrades gracefully when Qdrant is unavailable by setting a `_qdrant_available` flag to `False` at startup.
- **`app/services/transcript_svc.py`** — Async queue-based batched inserter so the hot audio path never blocks on database writes; transcript lines are enqueued in-memory and flushed to Postgres in batches.

## Data Flow at a Glance

1. **Caller dials the Twilio number** — Twilio POSTs to `/twilio/incoming`; the backend responds with `<Stream>` TwiML that instructs Twilio to open a WebSocket to `wss://host/media-stream`.
2. **Twilio connects the WebSocket and starts streaming audio** — the backend accepts the connection, creates a `CallSession` in `call_manager.py`, and opens a parallel WebSocket to the OpenAI Realtime API initialised with the TriageAgent's system prompt and tool definitions.
3. **Audio flows bidirectionally** — `audio_utils.py` decodes Twilio's 8 kHz mu-law frames to PCM16, resamples to 24 kHz for OpenAI, and reverses the process for the AI's reply. Transcripts captured on both sides are queued via `transcript_svc.py` and written to Postgres in the background.
4. **Function calls are handled in-band** — when the model emits a `function_call` event (e.g., `route_to_agent` or `book_appointment`), `openai_bridge.py` dispatches to the current agent's `handle_tool_call()`, waits for the result, and sends it back as a `function_call_output` message. Agent switches trigger a fresh `session.update` that swaps in the new agent's prompt and tools without dropping the call.
5. **When the call ends** — the `CallSession` is marked `COMPLETED`, and a background coroutine fires the post-call pipeline: summary generation via `gpt-4o-mini`, memory consolidation into Qdrant, an SMS notification to the clinic via Twilio, and optional export to Google Sheets.

## Two Voice Paths

The codebase supports two ways a voice call can enter the system:

### Twilio Path (Production)

```
Patient phone → Twilio PSTN → POST /twilio/incoming → WS /media-stream → OpenAI Realtime
```

This is the production path. Every audio frame is a base64-encoded G.711 mu-law WebSocket message from Twilio. The backend decodes, resamples, and forwards to OpenAI Realtime, which returns audio in PCM16 that gets re-encoded and sent back down the Twilio WebSocket. The entire audio round-trip stays inside the single persistent WebSocket pair, which is why latency is low enough for natural conversation.

### Vapi Path (Demo + Multilingual)

```
Browser (WebRTC) → @vapi-ai/web SDK → Vapi Cloud → POST /api/vapi/webhook (serverUrl)
                                                   → POST /api/vapi/tool-call (function calls only)
```

In this path, Vapi Cloud owns the voice channel, WebRTC, STT, and TTS. The FastAPI backend only receives HTTP POST requests when Vapi needs to invoke a function (e.g., `check_availability`, `route_to_agent`). This path is used for the browser demo widget in the dashboard and for multilingual calls because Vapi's STT supports Hindi and English auto-detection out of the box.

Both paths converge on the same agent logic. `TriageAgent`, `SchedulingAgent`, `MedicationAgent`, and `EmergencyAgent` have no knowledge of which voice path invoked them — they receive a tool-call name and arguments and return a result. This separation is intentional: it keeps the business logic testable in isolation and means a third voice provider could be added by writing a single new webhook handler.

## Multi-Agent System

The four agents are not separate processes or separate API calls. They are system-prompt and tool-definition swaps on a single, persistent OpenAI Realtime session. The call always begins with `TriageAgent`, which collects the patient's name, date of birth, and chief complaint. Based on the triage assessment, it calls `route_to_agent` with one of the four target agent names. `openai_bridge.py` intercepts this function call, loads the target agent's `get_system_prompt()` and `get_tools()`, and sends a `session.update` event to the OpenAI Realtime API. From the patient's perspective, the voice is continuous — there is no hold music, no transfer click, no "please hold while I transfer you." The model simply begins responding with the new agent's persona and capabilities.

### Agent Routing Table

| Agent | Trigger Condition | Key Tools |
|-------|------------------|-----------|
| `TriageAgent` | Every call starts here | `assess_urgency`, `route_to_agent`, `lookup_patient` |
| `SchedulingAgent` | Triage determines appointment needed | `check_availability`, `book_appointment`, `cancel_appointment` |
| `MedicationAgent` | Patient asks about drugs/dosage/refills | `lookup_medication`, `search_medical_knowledge` (RAG) |
| `EmergencyAgent` | Critical urgency detected | `notify_emergency_services`, `send_clinician_sms`, `stay_on_line` |

## Qdrant Collections

Three collections are created by `ensure_collections()` at startup:

| Collection | Vector Model | Purpose |
|------------|-------------|---------|
| `patient_memory` | `text-embedding-3-small` (1536-dim) | Per-patient episodic facts extracted post-call; retrieved at call start to personalise the greeting and avoid repeating questions |
| `medical_knowledge` | `text-embedding-3-small` (1536-dim) | Curated medical reference documents (drug monographs, symptom guides); queried by `MedicationAgent` via similarity search to ground its answers |
| `doctor_directory` | `text-embedding-3-small` (1536-dim) | Clinic doctors with specialties and availability; allows natural-language queries like "do you have a cardiologist?" to return structured results |

All three collections degrade gracefully: if `QDRANT_URL` is absent from the environment, the service sets `_qdrant_available = False` and every collection operation becomes a silent no-op. The application runs fully without Qdrant — it just loses memory and RAG capabilities — which is useful for CI environments and local testing without cloud credentials.

## Post-Call Pipeline

After every call, a background task runs a five-step pipeline without blocking the next incoming call:

1. Fetch the full transcript from Postgres.
2. Send transcript to `gpt-4o-mini` (JSON mode) to generate a structured summary: chief complaint, actions taken, follow-up needed, urgency level.
3. Write the summary back to the `calls` table.
4. Send transcript to `memory_svc.py`, which extracts up to five discrete facts (allergies, current medications, chronic conditions, recent visits) and upserts them into `patient_memory` in Qdrant.
5. If the call involved a high/critical urgency, send an SMS to the on-call clinician via the Twilio SMS API.

The pipeline is intentionally decoupled from the call itself. Even if the summary generation fails (e.g., OpenAI rate limit), the call transcript is already safely in Postgres and the failure is logged with structured context for retry.
