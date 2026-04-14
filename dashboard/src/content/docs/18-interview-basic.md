# Interview Q&A — Basic

Junior-level questions you might get if you're being introduced to the project.

**Q: What is MediCall AI in one sentence?**
A: It's an AI voice assistant for medical clinics that takes phone calls 24/7, triages patient symptoms, books appointments, and handles emergencies through a multi-agent system.

**Q: What's the tech stack?**
A: Backend is FastAPI (Python async) with SQLAlchemy + PostgreSQL, OpenAI Realtime API for voice, Twilio for phone calls, Qdrant for vector memory, and Vapi as an alternative voice path. Frontend is React 18 + Vite + Tailwind + Redux Toolkit + Socket.IO for real-time dashboard updates.

**Q: What's the role of FastAPI here?**
A: FastAPI is the web framework — it serves the REST API for patients/doctors/calls/appointments, accepts the Twilio MediaStream WebSocket, hosts the Vapi webhook handlers, and runs the Socket.IO server for the dashboard. We chose it because it's async-first (matches the streaming voice use case) and has built-in WebSocket and Pydantic support.

**Q: What is a WebSocket and why do we use it?**
A: A WebSocket is a persistent, bidirectional connection between client and server over a single TCP connection. We use them in two places: to receive Twilio audio in real time (Media Streams), and to forward that audio to OpenAI Realtime API. WebSockets are perfect for streaming use cases where you can't afford the overhead of repeated HTTP requests.

**Q: What does the multi-agent system do?**
A: We have four specialized AI agents — TriageAgent (entry point), SchedulingAgent (appointments), MedicationAgent (drug info), and EmergencyAgent (critical situations). Each has its own narrow system prompt and tools. The TriageAgent decides where to route based on what the patient says, then hands off mid-call by calling a `route_to_agent` tool.

**Q: Why is PostgreSQL a good fit?**
A: We need ACID guarantees for patient records and call data, and we use JSONB columns to store flexible medical context (allergies, conditions, medications) without separate tables. PostgreSQL gives us both — strict relational tables for the core entities and schema-less JSONB where flexibility matters.

**Q: What is Qdrant and why use a vector database?**
A: Qdrant is an open-source vector database. We use it to store embeddings of patient memories, medical knowledge chunks, and doctor profiles, so we can do semantic search ("heart specialist available Monday" matches "Dr. Patel cardiology"). A regular keyword search wouldn't find these matches.

**Q: How does the dashboard update in real-time?**
A: The backend uses `python-socketio` to emit events on a `/dashboard` namespace whenever a call starts, ends, transcribes a line, or switches agents. The React dashboard subscribes via `socket.io-client` in a `useSocket` hook and dispatches Redux actions to update the store. The UI re-renders automatically whenever the store changes.

**Q: What's the difference between async and sync in Python?**
A: Sync code blocks the thread while waiting for IO (DB queries, network requests). Async code uses `await` to pause a function and let the event loop run other tasks during IO waits. For our voice app, async is essential — we can handle hundreds of concurrent calls on a single thread because most of the time is spent waiting for audio chunks, not CPU work.

**Q: What does the TriageAgent do?**
A: It's the entry point for every call. It greets the patient, asks about their symptoms, decides how urgent the situation is, and either handles the call itself or routes to a more specialized agent (Scheduling, Medication, or Emergency). It also looks up patient memory from past calls if the phone number is recognized.

**Q: How do you test a voice AI locally without making real phone calls?**
A: Two ways. First, the dashboard has a `/demo` route powered by the Vapi Web SDK — judges or developers can call the AI from a browser. Second, you can use ngrok to expose your local backend, configure Twilio to point at your ngrok URL, and call the Twilio number from your phone — same as in production.

**Q: What is Twilio?**
A: Twilio is a cloud provider for phone numbers, SMS, and voice calls. We use Twilio for: receiving inbound calls (it forwards to our webhook), Media Streams (to forward live audio over WebSocket), outbound SMS for emergency alerts and post-call summaries, and outbound calls for the call-the-patient feature.

**Q: How are calls and patients stored?**
A: We have SQLAlchemy models for Patient, Call, TranscriptEntry, CallSummary, Appointment, and Doctor. Each Call belongs to a Patient. Each TranscriptEntry belongs to a Call. After a call ends, we generate a CallSummary row with extracted symptoms and an urgency level. Cascade deletes mean removing a Patient also removes all their calls and transcripts.

**Q: What's Vapi and why is there a separate path for it?**
A: Vapi is a managed voice AI platform — it wraps Twilio + STT + LLM + TTS behind one API. We use it for two things: a browser demo (so people can try the AI without a phone) and multilingual support (Vapi supports Hindi + English auto-detection out of the box). The Twilio path is still the primary production path because it gives us more control over the audio pipeline.

**Q: What is TwiML?**
A: TwiML is Twilio Markup Language — an XML format that tells Twilio what to do with a call. When Twilio receives a call, it makes an HTTP request to our FastAPI server, and we return TwiML that says "open a WebSocket to this URL and stream the audio." It's essentially a set of instructions Twilio follows to handle the call.

**Q: How does agent routing work mid-call?**
A: When TriageAgent decides a patient needs to book an appointment, it calls a `route_to_agent` tool with the target agent name ("scheduling"). Our backend receives this as a function-call event from OpenAI, looks up the SchedulingAgent, and sends a `session.update` event to the same OpenAI WebSocket with the new agent's system prompt and tools. The conversation history stays intact — only the instructions and tools change.

**Q: What does Redux do in the frontend?**
A: Redux Toolkit manages global state for the dashboard — the list of active calls, call statuses, transcript entries, agent states, and statistics. When a Socket.IO event arrives, the `useSocket` hook dispatches a Redux action. Redux slices (callsSlice, statsSlice) update the state, and React components re-render. It prevents prop-drilling and makes the real-time data flow predictable.
