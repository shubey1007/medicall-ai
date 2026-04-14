# Frequently Asked Questions

Common questions about MediCall AI from interviewers, stakeholders, and curious engineers.

**What does MediCall AI do?**
MediCall AI is a voice AI assistant for medical clinics. It accepts inbound phone calls 24/7, triages patient symptoms, books appointments, answers medication questions, and escalates emergencies — all through a multi-agent system that uses OpenAI Realtime API for natural conversation. Think of it as an always-available AI receptionist for a small clinic.

**Who is it for?**
Small to mid-size clinics that get hundreds of routine calls per day and can't afford or staff a 24/7 reception team. The receptionist's job is mostly answering the same 10 questions over and over — which AI is good at.

**How does a call actually work end-to-end?**
A patient dials the clinic's Twilio number. Twilio sends a webhook to our FastAPI server, which returns TwiML telling Twilio to open a WebSocket to our Media Stream handler. We accept the stream, open a second WebSocket to OpenAI Realtime API, and forward audio in both directions (with G.711 mu-law decoding and 8kHz↔24kHz resampling). The TriageAgent's system prompt and tools configure the model. When the call ends, we generate a summary with GPT-4o-mini and extract memories into Qdrant. The whole flow runs at sub-500ms latency.

**What happens if OpenAI is down?**
The call fails to connect — we'd return a Twilio "service unavailable" message. We don't have a fallback voice provider yet, though the architecture would support one (we could swap to Vapi or Azure Cognitive Speech behind a feature flag). In production this is the single biggest risk and would need a circuit breaker.

**Can it handle multiple languages?**
Yes — but only on the Vapi path. Vapi uses Deepgram nova-3 for multilingual transcription and PlayHT/ElevenLabs for multi-language TTS. The Twilio path is currently English-only because OpenAI Realtime's voice quality is best for English. We added "Always respond in English" to all agent prompts because OpenAI was occasionally auto-detecting and replying in Spanish.

**Is patient data HIPAA compliant?**
Honest answer: not yet. This is a demo build with no encryption-at-rest, no audit logging, no BAAs (Business Associate Agreements) with OpenAI/Twilio/Qdrant, and no auth on the dashboard. For real clinical use, every one of those gaps would need to be closed. The architecture is HIPAA-compatible (it's just code + Postgres + managed APIs), but the operational practices are not.

**How does the AI remember past calls?**
After every call, a background task uses GPT-4o-mini to extract up to 5 medical facts from the transcript ("Patient takes lisinopril for hypertension", "Patient reported chest pain rated 7/10"). Each fact is embedded with `text-embedding-3-small` and upserted into Qdrant's `patient_memory` collection with the patient_id in the payload. On future calls, TriageAgent calls `recall_patient_memory(query)` which does a semantic search filtered to that patient.

**How is emergency detection handled?**
TriageAgent uses an `assess_urgency` tool that returns one of low/medium/high/critical. If critical (chest pain, stroke symptoms, severe bleeding), TriageAgent routes to EmergencyAgent. EmergencyAgent immediately tells the caller to dial 911, collects location and symptoms, and fires `trigger_emergency_alert` which SMS-es the on-call clinician via Twilio.

**Why did you use OpenAI Realtime instead of Whisper + GPT?**
Latency. A stitched pipeline (Whisper → GPT-4 → ElevenLabs) has 3 sequential network hops. Each hop adds 200-500ms. For voice, anything over 1 second feels broken. OpenAI Realtime delivers first audio in ~500ms because STT, LLM, and TTS share one WebSocket. The tradeoff is vendor lock-in and higher cost per minute.

**What's the difference between the Twilio and Vapi paths?**
Twilio is the production path — we own the audio pipeline (mulaw decoding, resampling, OpenAI Realtime WebSocket). Vapi is a managed alternative — Vapi handles the audio, we just respond to webhook events with assistant config and tool-call results. Vapi gives us multilingual support and a browser demo (via the Vapi Web SDK) without phone setup. Both paths route to the same agent business logic.

**How much does each call cost roughly?**
Rough back-of-envelope: OpenAI Realtime is ~$0.06/min for input + ~$0.24/min for output audio. A 5-minute call = ~$1.50 in OpenAI costs. Twilio adds ~$0.0085/min for the phone number + audio = ~$0.05. Plus a few cents for Postgres/Qdrant/SMS. Call it ~$1.60 per 5-min call, dominated by OpenAI Realtime. Significantly cheaper than a human receptionist at ~$15/hour.

**Can you add a new agent?**
Yes, easily. Subclass `BaseAgent` in `backend/app/agents/`, implement `get_system_prompt()`, `get_tools()`, and `handle_tool_call()`. Add it to the agent registry in `vapi_webhook.py`. Update TriageAgent's `route_to_agent` enum to include the new name. About 30 minutes of work for a simple agent with a focused scope.

**Why two voice paths instead of just Vapi?**
Vapi is a managed wrapper; if Vapi has an outage, our entire voice path is down. The Twilio + OpenAI path gives us defense-in-depth and full control over the audio pipeline. Also, the Twilio path was built first and is more battle-tested for long calls with complex state.

**How do you handle a call that lasts 30 minutes?**
The OpenAI Realtime session has token limits — we'd hit the context window eventually. Currently no special handling. For long calls we'd need to summarize the conversation periodically and replace older messages with the summary, similar to how Anthropic's prompt caching works. This is a known gap in the current architecture.

**What does the post-call pipeline do?**
After a call ends, a background async task runs three things in sequence: first, GPT-4o-mini generates a structured summary (chief complaint, urgency, recommendations) and saves it as a `CallSummary` row; second, memory consolidation extracts medical facts and upserts them to Qdrant; third, notifications fire — SMS to the patient with a summary and optional Google Sheets export for clinic records. The pipeline is fire-and-forget so it doesn't block the Twilio WebSocket from closing.

**How does the real-time dashboard stay in sync with ongoing calls?**
The backend uses `python-socketio` on a `/dashboard` namespace. When any significant event happens — call starts, transcript line arrives, agent switches, call ends — the backend emits a Socket.IO event. The React dashboard subscribes via `socket.io-client` in a `useSocket` hook, dispatches the event as a Redux action, and the UI re-renders. Transcripts are batched in the DB but emitted immediately to Socket.IO so the dashboard feels instantaneous.

**Why PostgreSQL and not MongoDB for medical records?**
ACID guarantees. Patient records and call data are not the right fit for an eventually-consistent document store. We need confirmed writes — a booking that "kind of got saved" can mean a missed appointment for a sick patient. We do use PostgreSQL's JSONB type for flexible fields like allergies and medications, getting the best of both: strict relational structure where it matters, schema-less flexibility where it doesn't.

**What is Qdrant and why not just use PostgreSQL's pgvector?**
Qdrant is a purpose-built vector database with a rich filtering API. We use payload filters heavily — "search patient memories filtered to this patient_id" — which Qdrant handles very efficiently. pgvector would work at small scale but Qdrant gives us better performance and a cleaner separation of concerns. We run Qdrant in a Docker container so the operational overhead is low.
