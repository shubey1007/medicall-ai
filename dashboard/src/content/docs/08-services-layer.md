# Services Layer

The `backend/app/services/` directory holds every piece of business logic that isn't a REST route or WebSocket handler. Each file has one clear responsibility.

## call_manager.py

**In-memory registry of active `CallSession` objects, keyed by `call_sid`.**

The `CallManager` singleton is a plain dict (`Dict[str, CallSession]`) wrapped in `register`, `get`, `end`, `list`, `set_agent` methods. Every audio media event looks up the session here — so it lives in RAM for latency reasons. A Redis-backed session store would add 1-5ms per lookup which is unacceptable for a streaming audio path.

**Tradeoff:** not HA-safe. If the backend process dies mid-call, the session is lost and the call drops. For a demo/hackathon scale this is fine; for production we'd need sticky-session routing or Redis.

The `CallSession` dataclass holds the Twilio WebSocket reference, the OpenAI bridge, the DB Call/Patient IDs, the `current_agent` string, and timestamps. It's instantiated in `twilio_stream.py` on the Twilio `start` event.

## transcript_svc.py

**Async batched-insert service for TranscriptEntry rows.**

Transcripts arrive at several hundred per minute during an active call. Writing each one as a single INSERT would block the event loop and starve the audio path. This service decouples the two via an `asyncio.Queue`:

- Producer: `enqueue(call_id, role, content, agent_name=None)` pushes a dict into the queue (non-blocking).
- Consumer: a background task drains the queue, accumulating up to **10 entries** or **2 seconds** (whichever comes first), then does a single `db.add_all()` + `db.commit()`.

`start()` and `stop()` manage the consumer lifecycle — both are called from FastAPI's lifespan context manager in `main.py`. On shutdown, `stop()` signals the consumer to drain remaining entries before exiting (with a 5-second timeout).

## summary_svc.py

**Post-call summary generator.**

After a call ends, `generate_summary(call_id)` is called as a background task:
1. Loads the Call with all `transcript_entries` eagerly via `selectinload`
2. Concatenates them into a prompt: `[patient] Hello, I have a headache\n[agent:triage] I'm sorry to hear that...`
3. Calls OpenAI `gpt-4o-mini` with `SUMMARY_SYSTEM_PROMPT` and `response_format={"type": "json_object"}`
4. Parses `{summary_text, extracted_symptoms, urgency_level, recommended_actions}`
5. Inserts a `CallSummary` row
6. Fires `asyncio.create_task(_consolidate_memory(patient_id, call_id))` — captured in a local variable *inside* the session block to avoid `DetachedInstanceError`

**Important:** The patient_id is captured *before* the session closes. Accessing `call.patient_id` after `async with db_session() as db:` exits would fail if SQLAlchemy's `expire_on_commit=True` is in effect.

## memory_svc.py

**Post-call memory consolidation into Qdrant.**

`consolidate(patient_id, call_id, transcript_text)`:
1. Guards: returns early if transcript is empty, patient_id is None (Vapi demo path), or Qdrant is not configured
2. Calls `gpt-4o-mini` with `EXTRACTION_PROMPT` and JSON mode to return `{memories: [{text, type}, ...]}`
3. Takes up to 5 memories and upserts each into Qdrant `patient_memory` with metadata `{type, call_id}`
4. Stable MD5-hash IDs prevent duplicates on re-run

The function catches all exceptions and logs them — memory consolidation must never fail a call.

## qdrant_svc.py

**Async Qdrant client wrapper with graceful degradation.**

Three collections: `patient_memory`, `medical_knowledge`, `doctor_directory` — all using `text-embedding-3-small` (1536 dim, cosine distance).

Key design: a module-level `_qdrant_available: bool = False` flag that's only set to `True` after `ensure_collections()` successfully connects and creates collections. All search/upsert functions guard on this flag:
- Searches return `[]` if unavailable
- Upserts no-op if unavailable
- `embed()` raises a clear `RuntimeError` if unavailable (so callers fail fast on critical paths)

This lets the entire app start and run without Qdrant configured — features silently degrade instead of crashing.

**Stable point IDs:** `upsert_patient_memory` uses `uuid.UUID(hashlib.md5(f"{patient_id}:{text}").hexdigest())` so re-running consolidation on the same transcript is idempotent.

The `AsyncQdrantClient` singleton is lazily instantiated in `get_client()` and closed in `close_client()` on app shutdown to avoid leaked HTTP connections.

## notification_svc.py

**SMS sending via Twilio REST API.**

`send_post_call_sms(call_id)` formats a summary + next-steps SMS body and sends it via `TwilioClient(...).messages.create(to=patient_phone, from_=twilio_phone, body=...)`. No-op if Twilio is not configured. The call is wrapped in `asyncio.to_thread(...)` because the Twilio Python SDK is synchronous.

## sheets_sync.py

**Google Sheets export for call summaries (optional).**

`push_call_summary(...)` appends a row to a configured spreadsheet if `GOOGLE_SHEETS_CREDENTIALS_JSON` is set. Uses `gspread` with a service-account credential. Silently no-ops if credentials are missing — this is a nice-to-have for clinic staff who want to see summaries in a spreadsheet they can filter.

## vapi_session_svc.py

**Builds the Vapi assistant JSON config.**

`build_assistant_config(patient_name=None)` returns the payload Vapi expects in response to an `assistant-request` webhook. It instantiates a TriageAgent, grabs its system prompt + tools, and wraps them in Vapi's schema (model, voice, transcriber, firstMessage, serverUrl).

If a patient name is known, the system prompt is prefixed with "The patient's name is {name}." for a more personalized greeting.
