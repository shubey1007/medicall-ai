# Interview Q&A — Intermediate

Mid-level questions where you're expected to know the implementation details.

**Q: Walk me through the audio pipeline from the caller's mouth to OpenAI.**
A: Twilio captures the caller's audio at 8 kHz mu-law mono (G.711). It sends `media` events over WebSocket with a base64-encoded payload. Our handler in `twilio_stream.py` decodes the base64, calls `mulaw_to_pcm16()` (which uses `audioop.ulaw2lin`) to convert to 16-bit PCM at 8 kHz, then `resample_pcm16(..., 8000, 24000)` (which uses `audioop.ratecv`) to upsample to 24 kHz — OpenAI Realtime's required input format. Finally we re-encode as base64 and send `{type: "input_audio_buffer.append", audio: "..."}` to the OpenAI WebSocket. The reverse path runs on `response.audio.delta` events: 24 kHz PCM down to 8 kHz, encode to mulaw, base64, and send to Twilio.

**Q: How does agent routing preserve conversation context?**
A: When TriageAgent calls `route_to_agent`, our handler swaps the active agent on the `CallSession` and calls `bridge.update_session(new_agent)` which sends a new `session.update` event to OpenAI with the new system prompt and tools. Crucially, the OpenAI Realtime session itself is NOT restarted — all prior conversation messages stay in the session. So when the SchedulingAgent takes over, it sees everything the TriageAgent said. We're swapping instructions and tools, not state.

**Q: Why do you batch transcript writes?**
A: Transcripts arrive at hundreds per minute during an active call. If we did one INSERT per transcript, we'd block the audio path on DB IO — Postgres roundtrips are 1-5ms each. Instead, `transcript_svc.py` puts transcripts in an `asyncio.Queue` and flushes in batches of 10 entries or 2 seconds, whichever comes first. The audio path stays unblocked, and the DB sees fewer, larger inserts. We emit Socket.IO events in parallel to the queue enqueue so the dashboard sees transcripts in real time even though the DB write is delayed.

**Q: How does the app degrade when Qdrant is unavailable?**
A: The `qdrant_svc.py` module has a `_qdrant_available: bool = False` flag that's only flipped to True after `ensure_collections()` successfully connects at startup. Every search/upsert function checks this flag and either returns `[]` (search) or no-ops (upsert). `embed()` is the one exception — it raises a `RuntimeError` so callers fail fast. This means the app can start and run without Qdrant configured at all; memory features just silently degrade. We log a clear `qdrant_not_configured` warning on startup so the degradation is visible in logs.

**Q: Explain the post-call pipeline. Why is it fire-and-forget?**
A: When the call ends, we mark the Call as COMPLETED, then fire `_post_call_pipeline()` as a background task via `asyncio.create_task`. The pipeline runs three things in order: summary generation (GPT-4o-mini → CallSummary row), memory consolidation (extract facts → Qdrant), and notifications (SMS via Twilio + Google Sheets export). It's fire-and-forget for two reasons: first, the Twilio WebSocket needs to close immediately to free up the handler for the next call; second, summary failures shouldn't fail the call itself. Each stage is wrapped in try/except. We keep task references in a `_background_tasks` set to prevent the GC from collecting in-flight tasks.

**Q: What could go wrong with in-memory CallSession state?**
A: Three things. First, if the backend process dies mid-call, the session is lost and the call drops with no recovery. Second, multi-worker deployments don't share the dict — the worker that handles the WebSocket must be the same worker that handles function calls, which requires sticky session routing. Third, memory pressure scales with concurrent calls — each session holds the Twilio WebSocket, the OpenAI WebSocket, and various refs. For production we'd need a Redis-backed session store with a coordinator, but that adds latency to the hot audio path.

**Q: How do you prevent the AI from prescribing medication?**
A: Three layers of defense. First, the MedicationAgent's system prompt explicitly says "Never prescribe or recommend doses; always defer to the patient's doctor." Second, the only tools it has are `lookup_medication_info` (a curated database of drug names + general info) and `search_medical_knowledge` (Qdrant RAG over pre-seeded medical chunks) — neither tool produces dosing advice. Third, the TriageAgent's prompt routes anything that sounds like a request for personal medical advice back to "consult your doctor or pharmacist."

**Q: Describe the OpenAI Realtime function-calling flow.**
A: When the model decides to call a tool, it emits a `response.function_call_arguments.done` event with the tool name, JSON arguments, and a `call_id`. Our `_handle_event` dispatches to `_handle_tool_call` which calls `agent.handle_tool_call(name, args, session)`. The result dict is sent back to OpenAI as a `conversation.item.create` with `type=function_call_output` containing the JSON-stringified result and the same `call_id`. Crucially, we then send `response.create` to unblock the model — without this, OpenAI waits forever for us to signal the next response turn.

**Q: How does the Vapi path reuse agent logic?**
A: Both paths share the `BaseAgent` interface and the four agent subclasses. The Twilio path uses `OpenAIRealtimeBridge` to forward function calls into `agent.handle_tool_call`. The Vapi path uses `vapi_webhook.py` which receives function calls via `POST /api/vapi/tool-call`, looks up the current agent from an in-memory `_call_agents` dict keyed by Vapi call_id, and calls the same `agent.handle_tool_call` method with a `_MockSession` that fills in the minimum interface (patient_id is None for demo calls). So the business logic is identical regardless of which voice provider triggered it.

**Q: What's the difference between `response.audio.delta` and `response.audio_transcript.done`?**
A: `response.audio.delta` is the actual audio chunk — base64 PCM16 24kHz that needs to be transcoded and forwarded to Twilio as the AI speaks. It fires many times during a single utterance. `response.audio_transcript.done` is a single event that fires once at the end of an utterance, containing the complete text the AI just spoke. We forward `audio.delta` to Twilio for the caller's ear, and we capture `audio_transcript.done` as a TranscriptEntry for the dashboard and database.

**Q: Why hash memory text for point IDs instead of using random UUIDs?**
A: Idempotency. If the post-call pipeline fails halfway and we re-run it, we don't want duplicate memories in Qdrant. By deriving the point ID from `md5(patient_id + memory_text)`, we guarantee that the same input always maps to the same UUID, so re-runs upsert (overwrite) instead of accumulate. MD5 is fine here because we're using it as a content-addressable hash, not for security — collisions for distinct memory texts are vanishingly unlikely.

**Q: How would you add a new agent type?**
A: Subclass `BaseAgent` in a new file under `backend/app/agents/`, implement `get_system_prompt()` (the agent's instructions), `get_tools()` (the JSON tool list including `route_to_agent` and `end_call`), and `handle_tool_call(name, args, session)` (the dispatcher for tool execution). Add the agent to the `_agent_registry` dict in `vapi_webhook.py` so the Vapi path can route to it. Update TriageAgent's system prompt to know about the new agent and route to it under appropriate conditions. About 30 minutes of work for a simple agent.

**Q: Why does the AI sometimes need a `response.create` after a tool call?**
A: OpenAI Realtime is a turn-based protocol. When the model calls a function, the server returns the function call event, then waits for us to send the result and signal that we want it to continue. We send `conversation.item.create` with the result, then `response.create` to tell the model "OK, you have the result, generate the next response now." Without `response.create`, the model just sits waiting and the user hears silence.

**Q: How does semantic search work for doctor lookup?**
A: When SchedulingAgent calls `find_doctor(specialty, query)`, we embed the query text using OpenAI's `text-embedding-3-small` model, then search the `doctor_directory` Qdrant collection using cosine similarity. The doctor profiles are pre-embedded at seeding time with their name, specialty, bio, and available days. A query like "I need a heart doctor available on Fridays" can semantically match "Dr. Patel, Cardiologist, available Mon/Wed/Fri" even without exact keyword overlap. We return the top 3 matches and let the LLM pick the best fit.

**Q: What happens to a call if the database is down?**
A: The call can still be handled — the voice path (Twilio WebSocket → OpenAI WebSocket) doesn't depend on Postgres at all. Postgres is only touched at the start (look up patient by phone number) and end (write transcript, summary). If the initial patient lookup fails, we log the error and proceed with `patient_id=None` — the AI still talks to the caller, just without personalized memory. If the final write fails, we log the error but the caller already had their conversation. It's the same graceful-degradation pattern as Qdrant — keep the voice path alive.
