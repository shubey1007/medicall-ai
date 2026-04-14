# External Integrations

MediCall AI talks to five external services. Each has its own auth, event model, and gotchas.

## Twilio

**Purpose:** Phone numbers, inbound webhooks, Media Streams (audio over WebSocket), outbound SMS + calls.

**Auth:** `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` (HTTP Basic). Webhook payloads are signed — we verify the `X-Twilio-Signature` header with `twilio.request_validator.RequestValidator` to prevent spoofing.

**Key endpoints/events:**
- Inbound: `POST /twilio/incoming` — returns TwiML with `<Stream url="wss://.../media-stream">`
- WebSocket: `WS /media-stream` — receives `connected`, `start`, `media`, `stop` events
- Outbound: `twilio.rest.Client().calls.create(url=twiml_url, to=..., from_=...)`
- SMS: `client.messages.create(to=..., from_=..., body=...)`

**Gotchas:**
- Audio must be **G.711 mu-law, 8 kHz, mono**. Any other format is silently dropped.
- Media events send base64-encoded payloads. You must decode before processing.
- The `start` event contains `customParameters` echoed from the TwiML — that's how we pass `dbCallId` / `patientId` into the WebSocket handler.
- Twilio's Python SDK is **synchronous** — wrap calls in `asyncio.to_thread(...)` to avoid blocking the event loop.

## OpenAI Realtime API

**Purpose:** Speech-to-text + LLM + text-to-speech in a single WebSocket.

**Auth:** `Authorization: Bearer sk-...` header + `OpenAI-Beta: realtime=v1` header.

**WebSocket URL:** `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`

**Key events we send:**
- `session.update` — configure agent: instructions, tools, voice, audio format, VAD, transcription model
- `input_audio_buffer.append` — push audio chunk (base64 PCM16 24kHz)
- `response.create` — trigger the model to speak/think
- `conversation.item.create` with `type=function_call_output` — return tool results

**Key events we receive:**
- `response.audio.delta` — outgoing audio chunk (base64 PCM16 24kHz)
- `response.audio_transcript.done` — final agent transcript
- `conversation.item.input_audio_transcription.completed` — final patient transcript
- `response.function_call_arguments.done` — the model is invoking a tool
- `error` — protocol or auth errors

**Gotchas:**
- Audio chunks must be **2-byte aligned** (PCM16 samples are 2 bytes each). `audioop` will raise if you pass an odd-length buffer.
- After sending `function_call_output`, you must also send `response.create` to unblock the model — otherwise it waits forever.
- The session maintains full conversation history, so mid-call agent swaps via `session.update` don't lose context.

## Vapi

**Purpose:** Alternative managed voice platform for demo + multilingual.

**Auth:** `Authorization: Bearer <vapi_api_key>` header. Public API key is used in the browser SDK; server key for REST calls.

**Key endpoints:**
- Inbound: `POST /api/vapi/webhook` — Vapi calls us for lifecycle events (`assistant-request`, `status-update`, `end-of-call-report`)
- Function calls: `POST /api/vapi/tool-call` — Vapi sends us `functionCall` messages
- Outbound: `POST https://api.vapi.ai/call/phone` — we call Vapi to initiate outbound reminder calls (`VAPI_PHONE_NUMBER_ID` required)

**Assistant config shape:**

```json
{
  "name": "MediCall AI",
  "model": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "messages": [{"role": "system", "content": "..."}],
    "tools": [...]
  },
  "voice": {"provider": "11labs", "voiceId": "burt"},
  "transcriber": {"provider": "deepgram", "model": "nova-2", "language": "en-US"},
  "firstMessage": "Hello!",
  "serverUrl": "https://.../api/vapi/tool-call"
}
```

**Gotchas:**
- Use `messages: [{role: "system", ...}]`, NOT the deprecated `systemPrompt` field. Wrong format → "Meeting has ended / ejected" immediately on call start.
- `playht` voices may not be available on free tier — stick with `11labs`.
- Multilingual auto-detection requires `deepgram nova-3`, not `nova-2` (nova-2 only supports one language at a time).
- Partial transcripts (`transcriptType: "partial"`) stream in as the speaker talks. Filter on `"final"` to avoid spamming your UI.

## Qdrant

**Purpose:** Vector database for semantic memory (3 collections).

**Auth:** `api_key` passed to `AsyncQdrantClient(url=..., api_key=...)`.

**Client:** `qdrant-client>=1.9.0,<2.0.0` — we pin the upper bound because v1.10 deprecated `client.search()` in favor of `client.query_points()`.

**Collections:**
- `patient_memory` — per-patient episodic, filtered by `patient_id` on search
- `medical_knowledge` — pre-seeded RAG chunks from `backend/data/medical_kb.json`
- `doctor_directory` — synced from Postgres Doctor rows

All collections use `text-embedding-3-small` (1536 dim) and cosine distance.

**Gotchas:**
- Filtering requires a `Filter(must=[FieldCondition(key="patient_id", match=MatchValue(value="..."))])` — not just a plain dict.
- Collection creation is idempotent via `ensure_collections()` — safe to call on every startup.
- Point IDs must be UUIDs or ints. We derive stable UUIDs from `md5(patient_id + text)` for idempotent upserts.

## Google Sheets (Optional)

**Purpose:** Export call summaries to a shared spreadsheet for clinic staff.

**Auth:** Service account credentials JSON (`GOOGLE_SHEETS_CREDENTIALS_JSON`) + spreadsheet ID.

**Library:** `gspread`

**Gotcha:** Service account must be granted Editor access to the target spreadsheet. If the file is missing or credentials are invalid, the sync silently no-ops and logs a warning — it's an opt-in feature, not a blocker.
