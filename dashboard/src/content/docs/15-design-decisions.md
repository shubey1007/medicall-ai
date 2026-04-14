# Design Decisions

The interesting choices we made and the tradeoffs behind each one.

## 1. Async-First FastAPI

**Decision:** The entire backend is async — FastAPI, SQLAlchemy 2.0 async, asyncpg, async OpenAI client, async websockets.

**Why:** Voice latency demands non-blocking IO. A single sync DB query (~10ms) blocks the event loop for every concurrent caller — at 100 concurrent calls, blocking once would add 100ms of jitter to everyone. Async lets us interleave audio chunks, transcript inserts, and OpenAI calls without thread overhead.

**Tradeoff:** Async Python is harder to debug. Stack traces span event-loop boundaries, and `asyncio.create_task` can silently swallow exceptions if you don't add error handlers. We mitigate this with structlog and `_background_tasks` reference sets.

**Alternative considered:** Flask + threads. Simpler mental model but doesn't scale past ~50 concurrent calls without significant memory overhead per thread.

## 2. In-Memory CallSession Registry

**Decision:** Active call state lives in a Python dict (`CallManager`) rather than Redis or Postgres.

**Why:** Every Twilio media event (~50/sec per call) needs to find the right CallSession. A Redis lookup adds 1-5ms; a Postgres lookup adds 5-20ms. At our packet rate this would cumulatively add hundreds of milliseconds of latency per call.

**Tradeoff:** Not HA. If the backend process dies, every active call drops. Multi-worker deployments would also need sticky session routing because workers don't share the dict.

**Alternative considered:** Redis-backed sessions. Better for HA but adds latency to the hot path. Acceptable for a future production version where calls are rare and HA matters more than per-event latency.

## 3. Batched Transcript Writes

**Decision:** TranscriptEntry inserts go through an `asyncio.Queue` and are flushed in batches (10 entries or 2 seconds).

**Why:** Direct per-event inserts would block the audio path on DB IO. Batching converts hundreds of single-row inserts into a handful of multi-row inserts, dramatically reducing DB pressure.

**Tradeoff:** Up to 2 seconds of lag before the dashboard sees a transcript line. Mitigated by emitting Socket.IO events in parallel to the queue enqueue, so the dashboard sees transcripts in real time even though the DB write is delayed.

**Alternative considered:** Per-event direct writes. Simpler but couples the audio path latency to the DB latency.

## 4. Graceful Qdrant Degradation

**Decision:** The `_qdrant_available` flag pattern — if Qdrant isn't configured or connection fails at startup, all search/upsert operations no-op silently.

**Why:** A new developer cloning the repo without Qdrant credentials should still be able to run the app and make calls. Qdrant is a feature enhancer, not a hard dependency.

**Tradeoff:** Silent feature loss is hard to detect. Mitigated by logging a clear `qdrant_not_configured` warning at startup so it's visible in logs.

**Alternative considered:** Hard-fail startup if Qdrant isn't reachable. Cleaner failure mode but worse developer experience.

## 5. Stable MD5-Derived Point IDs

**Decision:** `upsert_patient_memory` derives a deterministic UUID from `md5(patient_id + memory_text)` instead of using `uuid.uuid4()`.

**Why:** Re-running the post-call memory pipeline (e.g., after a transient OpenAI failure) shouldn't create duplicate points. Same input → same point ID → upsert overwrites.

**Tradeoff:** Can't store two memories with identical text for the same patient. Acceptable because such duplicates aren't useful anyway.

**Alternative considered:** Random UUIDs + dedup logic. More flexible but requires a Qdrant query before every upsert to check for existing similar points.

## 6. OpenAI Realtime for Voice (Not Stitched Pipeline)

**Decision:** Use OpenAI Realtime as a single WebSocket for STT + LLM + TTS instead of stitching Whisper + GPT-4 + ElevenLabs.

**Why:** Latency. A stitched pipeline has 3 sequential network hops, each adding 200-500ms. Realtime delivers first audio in ~500ms total. For voice, latency is the dominant UX metric.

**Tradeoff:** Vendor lock-in to OpenAI. A self-hosted alternative would require building our own STT-LLM-TTS pipeline.

**Alternative considered:** Whisper + GPT-4 + ElevenLabs. Theoretically more flexible (mix-and-match models) but operationally much more complex and slower.

## 7. Agent-Per-Domain Instead of One Mega-Prompt

**Decision:** Four separate agents (TriageAgent, SchedulingAgent, MedicationAgent, EmergencyAgent), each with a tight prompt and 3-6 tools.

**Why:** A single mega-prompt with all 15+ tools would be slower (more tokens), more expensive, more prone to wrong-tool hallucinations, and harder to reason about during debugging. Per-agent prompts are tight, role-specific, and easy to test in isolation.

**Tradeoff:** Routing overhead — `route_to_agent` requires a `session.update` swap mid-call. Adds maybe 100-200ms of latency on each handoff but is invisible because the model is usually generating speech during the swap.

**Alternative considered:** Single mega-agent with all tools. Initially built this way; performance degraded noticeably as we added tools.

## 8. Two Voice Paths (Twilio + Vapi)

**Decision:** Maintain both a direct Twilio MediaStream + OpenAI Realtime path AND a Vapi serverUrl path, sharing the same agent business logic.

**Why:** Twilio is battle-tested for production phone calls. Vapi gives us a browser demo (no phone needed), multilingual support out of the box, and a fast path to outbound campaigns. Both share the agent layer so business logic isn't duplicated.

**Tradeoff:** Two integration surfaces to maintain and test. Justified because each path serves a real use case.

**Alternative considered:** Pick one. Twilio-only would lose the browser demo; Vapi-only would give us less control over the audio pipeline.
