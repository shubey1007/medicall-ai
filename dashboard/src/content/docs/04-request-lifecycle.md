# Request Lifecycle — Inbound Twilio Call

Step-by-step walkthrough of what happens when a patient dials the Twilio number.

## Overview

When a patient dials the clinic's Twilio number, Twilio POSTs call metadata to our webhook, which validates the request, upserts the patient record, creates a Call row, and responds with TwiML that upgrades the HTTP connection to a WebSocket media stream. Our server accepts that WebSocket, extracts the call parameters Twilio echoes back, and opens a second WebSocket to the OpenAI Realtime API — establishing a bidirectional audio bridge. From that point forward, raw µ-law audio from the patient's phone is transcoded to 24kHz PCM16 and forwarded to OpenAI, while OpenAI's synthesized speech is transcoded back to 8kHz µ-law and returned to Twilio. Transcripts are batched to Postgres in real time. When the patient invokes a tool (e.g., booking an appointment), the Realtime model fires a function-call event that our server dispatches to the active agent; if the agent decides to hand off, we swap the system prompt and tool list mid-call using `session.update` without restarting the conversation. When the patient hangs up, a post-call pipeline generates a summary, consolidates memories into Qdrant, sends an SMS, and exports to Google Sheets.

---

## Step 1: Twilio Webhook

**File:** `backend/app/api/webhooks.py` — `POST /twilio/incoming`

When a patient calls the Twilio number, Twilio POSTs to our webhook with form-encoded call metadata (CallSid, From, To). We:

1. Validate the Twilio signature using `RequestValidator` (prevents spoofed calls). The validator reconstructs the expected HMAC-SHA1 signature from our auth token and the full request URL; if it does not match the `X-Twilio-Signature` header, we return 403 immediately.
2. Upsert the Patient row by phone number — if the caller is new, a fresh Patient record is created with `phone=From`; if they have called before, we fetch the existing row so we can address them by name.
3. Create a `Call` row with `status=RINGING`, `current_agent="triage"`, `call_sid=CallSid`, and a foreign key to the Patient.
4. Return TwiML:
   ```xml
   <Response>
     <Connect>
       <Stream url="wss://{host}/media-stream">
         <Parameter name="callSid" value="..."/>
         <Parameter name="patientPhone" value="..."/>
         <Parameter name="dbCallId" value="..."/>
         <Parameter name="patientId" value="..."/>
       </Stream>
     </Connect>
   </Response>
   ```

The `<Parameter>` elements are critical: they are how we pass `callSid`, `patientPhone`, `dbCallId`, and `patientId` to the WebSocket handler. Twilio echoes them back verbatim inside the `start` event's `customParameters` object. Without them we would have no way to correlate the WebSocket connection to the database rows we just created in this HTTP handler.

---

## Step 2: WebSocket Accept

**File:** `backend/app/websocket/twilio_stream.py` — `WS /media-stream`

Immediately after Twilio receives the TwiML, it opens a WebSocket to our server. Our handler:

1. Calls `await websocket.accept()` to complete the WebSocket handshake.
2. Enters an event loop waiting for the first `start` event from Twilio. Twilio sends this event before any audio, and it contains the stream SID as well as the `customParameters` we embedded in the TwiML.
3. Extracts `callSid`, `patientPhone`, `dbCallId`, and `patientId` from `start.customParameters`.
4. Loads the Patient row from Postgres using `selectinload` so that related rows (e.g., appointment history) are eagerly fetched in one query rather than triggering N+1 lazy loads later.
5. Creates a `CallSession` dataclass (defined in `backend/app/services/call_manager.py`) that holds: `call_sid`, `stream_sid`, `db_call_id`, `patient_phone`, `patient_id`, a reference to the Twilio WebSocket (`twilio_ws`), and `current_agent="triage"`.
6. Registers the session in the `CallManager` singleton — an in-memory dict keyed by `call_sid`. The singleton is imported wherever call sessions need to be looked up (e.g., from REST endpoints that need to inject audio mid-call).
7. Transitions the Call row in Postgres to `status=ACTIVE` and stamps the patient name onto the session object.
8. Emits a `call:started` Socket.IO event to all connected dashboard clients so the live call list updates instantly.

---

## Step 3: Connect to OpenAI Realtime

**File:** `backend/app/websocket/openai_bridge.py` — `OpenAIRealtimeBridge.connect()`

With the Twilio side established, we instantiate `OpenAIRealtimeBridge(session, on_tool_call=_handle_tool_call)` and call `await bridge.connect(initial_agent=TriageAgent())`.

Inside `connect()`:

1. Open a WebSocket to `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview` with two required headers: `Authorization: Bearer {OPENAI_API_KEY}` and `OpenAI-Beta: realtime=v1`.
2. Send a `session.update` event containing TriageAgent's system prompt, its tool definitions (as OpenAI function schemas), `voice="alloy"`, `input_audio_format="pcm16"`, `output_audio_format="pcm16"`, server-side VAD configuration (silence threshold, prefix padding, silence duration), and `input_audio_transcription: {model: "whisper-1"}` to enable transcription events.
3. Send `response.create` to instruct the model to produce an opening greeting immediately — without this, the model waits for the caller to speak first, which creates an awkward silence.
4. Spawn a background asyncio task running `_receive_loop()`. This loop reads events from the OpenAI WebSocket and dispatches them to `_handle_event()`, which routes each event type (audio delta, transcript, function call, etc.) to the appropriate handler.

---

## Step 4: Audio Loop (Bidirectional)

**Files:** `twilio_stream.py` (Twilio → OpenAI), `openai_bridge.py` (OpenAI → Twilio), `audio_utils.py` (codec)

The audio pipeline runs as two concurrent async loops bridging two WebSocket connections.

**Twilio → OpenAI (patient speaking):**

1. Twilio sends `media` events: `{event: "media", media: {payload: "<base64 µ-law 8kHz>"}}`
2. We base64-decode the payload to raw bytes.
3. Call `mulaw_to_pcm16()` which uses Python's `audioop.ulaw2lin` to convert 8-bit µ-law to 16-bit signed PCM.
4. Call `resample_pcm16(data, from_rate=8000, to_rate=24000)` using `audioop.ratecv` to upsample from the telephone 8kHz sample rate to the 24kHz rate OpenAI Realtime expects.
5. Base64-encode the result and send it to OpenAI as `{type: "input_audio_buffer.append", audio: "<base64 pcm16 24kHz>"}`.

OpenAI's server-side VAD detects speech boundaries and fires `input_audio_buffer.speech_started` / `input_audio_buffer.speech_stopped` events automatically — we do not need to implement VAD ourselves.

**OpenAI → Twilio (AI speaking):**

1. OpenAI sends `response.audio.delta` events as the model generates speech. Each delta contains a base64-encoded chunk of 24kHz PCM16 audio.
2. We base64-decode to bytes.
3. Ensure 2-byte alignment: if the byte count is odd (can happen at chunk boundaries), we drop the trailing byte to avoid corrupting the 16-bit sample boundary.
4. Call `resample_pcm16(data, from_rate=24000, to_rate=8000)` to downsample back to telephone quality.
5. Call `pcm16_to_mulaw()` using `audioop.lin2ulaw` to convert back to µ-law.
6. Base64-encode and send to Twilio as `{event: "media", streamSid: session.stream_sid, media: {payload: "<base64 mulaw 8kHz>"}}`.

This loop runs at whatever cadence OpenAI streams audio deltas — typically many small chunks per second, producing smooth speech playback on the caller's phone.

---

## Step 5: Transcription Events

Two OpenAI Realtime events capture transcripts:

- **`conversation.item.input_audio_transcription.completed`** — fires after Whisper finishes transcribing a patient utterance. We extract the text and create a `TranscriptEntry` with `role=PATIENT`.
- **`response.audio_transcript.done`** — fires when the model finishes producing a speech response. We extract the full transcript text and create a `TranscriptEntry` with `role=AGENT`.

Both feed into `transcript_service.enqueue()` (`backend/app/services/transcript_svc.py`). This service maintains an `asyncio.Queue` and a background worker that batches inserts — accumulating up to 10 entries or 2 seconds (whichever comes first) before issuing a single bulk `INSERT`. Batching matters because individual INSERTs during a rapid back-and-forth conversation would thrash Postgres with dozens of small writes per minute.

In parallel, the WebSocket handler emits `call:transcript` Socket.IO events to all connected dashboard clients so the transcript panel updates live without polling.

---

## Step 6: Function Calls

The OpenAI Realtime model indicates a tool invocation by sending `response.function_call_arguments.done` after streaming the complete JSON arguments. Our `_handle_event()` method in `openai_bridge.py` extracts three fields:

- `name` — the tool name (e.g., `"book_appointment"`)
- `arguments` — the JSON string, which we immediately `json.loads()` to a dict
- `call_id` — a unique identifier for this invocation that we must echo back in the result

It then calls `_on_tool_call(name, args)`, the callback we wired in at construction time, which routes to `_handle_tool_call()` in `twilio_stream.py`.

`_handle_tool_call()`:

1. Looks up the current agent by reading `session.current_agent` (e.g., `"triage"`).
2. Calls `agent.handle_tool_call(tool_name, arguments, session)` — the agent executes the business logic (DB query, external API call, etc.) and returns a result dict.
3. Sends the result back to OpenAI as:
   ```json
   {
     "type": "conversation.item.create",
     "item": {
       "type": "function_call_output",
       "call_id": "<call_id>",
       "output": "<json.dumps(result)>"
     }
   }
   ```
4. Immediately sends `{type: "response.create"}` so OpenAI uses the function result to generate the next spoken response. Without this second send, the model waits indefinitely for more input before resuming.

---

## Step 7: Agent Routing (Mid-Call Handoff)

If the tool invocation was `route_to_agent` (detected by calling `agent.should_route(tool_name)` which returns `(True, target_name)` for that tool name), the result dict contains `{status: "routing", target: "scheduling"}`. The routing handler in `twilio_stream.py` then:

1. Updates `session.current_agent = "scheduling"` so subsequent tool calls are dispatched to the new agent.
2. Instantiates the target agent: `new_agent = SchedulingAgent()`.
3. Calls `bridge.update_session(new_agent)`, which re-sends a `session.update` event to OpenAI with the new agent's system prompt and the new agent's tool list. The prior audio and conversation messages are **not** affected — only the instructions and available tools change.
4. Logs a SYSTEM-role `TranscriptEntry` with the text `"Routed from triage to scheduling"` so the dashboard and post-call summary reflect the handoff.
5. Emits a `call:agent_changed` Socket.IO event to the dashboard, which updates the active-agent badge in the call monitor UI.

**Key insight:** The OpenAI Realtime session is NOT restarted. All prior conversation messages remain in the session context. We are only swapping what the model is *allowed to talk about* going forward — essentially a runtime prompt and tool surface swap on a live session.

---

## Step 8: Call End

When the patient hangs up, Twilio sends a `stop` event over the WebSocket. Our `_finalize_call()` function:

1. Marks the `Call` row as `status=COMPLETED`, sets `ended_at=now()`, and computes `duration_seconds = ended_at - started_at`.
2. Unregisters the `CallSession` from the `CallManager` singleton so it can be garbage collected.
3. Closes the OpenAI Realtime WebSocket gracefully with `await bridge.close()`.
4. Fires `_post_call_pipeline(call_id, session)` as a background asyncio task. The task reference is stored in a module-level `_background_tasks: set` — this prevents Python's garbage collector from discarding the coroutine before it finishes, which would happen silently if the task had no strong references.
5. Emits `call:ended` to the dashboard.

The post-call pipeline runs fully asynchronously and performs four operations in sequence:

- **`summary_svc.generate_summary(call_id)`** — fetches all `TranscriptEntry` rows for the call, formats them into a dialogue string, sends it to `gpt-4o-mini` with a structured summarization prompt, and persists a `CallSummary` row.
- **`memory_svc.consolidate(patient_id, call_id)`** — extracts durable facts about the patient (chronic conditions, medications, preferences) from the transcript and upserts them as dense vectors into the Qdrant `patient_memory` collection, keyed by `patient_id`.
- **`notification_svc.send_post_call_sms(patient_phone, summary)`** — uses the Twilio REST client to send a brief SMS recap to the patient's phone number.
- **`sheets_sync.push_call_summary(call_id)`** — appends a row to a configured Google Sheet for clinic staff to review offline.

---

## Why OpenAI Realtime?

> The entire voice pipeline — speech-to-text, LLM reasoning, and text-to-speech — runs over a **single WebSocket**. Compare that to a stitched architecture (Whisper → GPT-4 → ElevenLabs) where each hop adds 200–500 ms of latency. OpenAI Realtime delivers near-human response time (~500 ms to first audio byte) because there is no handoff between services. The model streams audio tokens as it generates them, so the caller starts hearing the response while the model is still reasoning — identical to how a human begins speaking before they have finished formulating every word.
