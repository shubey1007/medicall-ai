# Tech Stack

Every technology choice with the "why" behind it.

## Backend

| Library | Why |
|---------|-----|
| FastAPI | Async-first Python framework with native WebSocket support for Twilio MediaStream and type-safe Pydantic request/response models. Dependency injection and automatic OpenAPI docs come for free. |
| SQLAlchemy 2.0 async + asyncpg | Modern `Mapped[]` typing API replaces string-based column definitions; non-blocking DB access matches the async event loop so audio processing never stalls waiting for a query. |
| Alembic | Schema migrations keep the database in sync with the codebase — the `doctors` table, for example, was added after the initial release without touching production data. |
| PostgreSQL | `JSONB` columns power flexible `medical_context` per patient without requiring additional tables; mature full-text search is available if we later want keyword search over transcripts. |
| websockets (client) | Low-level WebSocket client library used by `openai_bridge.py` to maintain the persistent connection to the OpenAI Realtime API; chosen for its minimal abstraction over raw WebSocket frames. |
| python-socketio | Server-side Socket.IO implementation that broadcasts call events (`call_started`, `transcript_chunk`, `agent_switched`, `call_ended`) to connected dashboard clients in real time. |
| Twilio Python SDK | Handles webhook signature verification (prevents spoofed requests), outbound call initiation, and SMS delivery for emergency on-call notifications. |
| OpenAI Python SDK | Used for two offline tasks: `gpt-4o-mini` Chat Completions for post-call summary generation (JSON-mode) and `text-embedding-3-small` to produce vectors before upserting into Qdrant. |
| qdrant-client | Async vector DB client (`AsyncQdrantClient`) for the three Qdrant collections: `patient_memory`, `medical_knowledge`, and `doctor_directory`. |
| httpx | Async HTTP client for REST calls to the Vapi API (outbound appointment reminders) and any third-party clinical APIs. Chosen over `requests` because blocking HTTP in an async app causes subtle event-loop stalls. |
| pydantic-settings | Env-driven configuration with `.env` file support and an `lru_cache` singleton so settings are parsed once at startup and never re-read from disk during a call. |
| structlog | Structured JSON logging with bound context (call_sid, agent_name, patient_id) automatically included in every log line — easy to grep locally, easy to ship to Loki or Datadog in production. |
| audioop-lts | Pure-Python G.711 mu-law codec and `ratecv` sample-rate converter. The Python 3.13 standard library removed the `audioop` module; `audioop-lts` is the drop-in replacement that decodes Twilio's 8 kHz mu-law audio to PCM16 and re-encodes OpenAI's 24 kHz PCM16 back to mu-law for Twilio. |

## Frontend

| Library | Why |
|---------|-----|
| React 18 + Vite | Fast development server with native ESM and sub-millisecond hot-module replacement; React 18 concurrent features make the live-updating call list smoother under rapid socket updates. |
| React Router v6 | Declarative nested routing for the dashboard pages (live calls, call history, analytics, patient records). Loader/action pattern keeps data-fetching co-located with routes. |
| Redux Toolkit | Manages `activeCalls` — a dictionary keyed by `callSid` — so any component can read or update a specific call's state without prop-drilling. RTK's `createSlice` removes the boilerplate that made plain Redux verbose. |
| Axios | HTTP client for REST API calls to the FastAPI backend; interceptors add the auth token header in one place rather than every request site. |
| socket.io-client | Subscribes to the backend Socket.IO namespace and dispatches Redux actions on each incoming event so the UI updates in real time. |
| Tailwind CSS | Utility-first styling keeps design consistent without context-switching between JSX and external CSS files; purge step keeps the production bundle small. |
| Recharts | Composable SVG chart library for the analytics page (call volume over time, urgency distribution pie chart, average call duration). |
| @vapi-ai/web | Browser voice call via WebRTC — the `useVapi` hook wires microphone access, WebRTC negotiation, and event handling into a clean React interface so judges can demo the AI without a physical phone. |
| react-markdown + remark-gfm + react-syntax-highlighter | Renders this interview documentation (and future help articles) inside the dashboard. Keeps docs version-controlled in Markdown rather than in a separate CMS. |

## Infrastructure

| Tool | Why |
|------|-----|
| Docker Compose | A single `docker compose up` brings up the FastAPI backend, PostgreSQL, and ngrok. Eliminates "works on my machine" onboarding problems. |
| ngrok | Creates a public HTTPS tunnel so that Twilio and Vapi webhooks can reach a locally-running development server. The `ngrok` service in Compose auto-registers the tunnel URL. |
| Qdrant Cloud (free tier) | Fully managed vector database — no container to tune, no disk to provision. Graceful degradation is built in: if `QDRANT_URL` is missing from the environment, the `qdrant_svc.py` sets `_qdrant_available = False` and all vector operations become no-ops, so the app still runs in environments without a vector DB. |

## Design Philosophies

### Async-First Python

Voice latency is the primary user-experience metric in a phone AI. If the backend blocks for even 200 ms waiting for a database query or an HTTP response, the caller hears a perceptible gap. The entire backend is therefore built on Python's `asyncio` event loop: FastAPI handles requests and WebSockets natively without threads, `asyncpg` issues non-blocking database queries, `AsyncQdrantClient` reads from the vector store without yielding the thread, and `httpx` makes outbound HTTP calls without stalling. The one place where blocking code is allowed is the startup/shutdown lifespan hooks — schema checks and collection creation run once, so a brief block is acceptable. This discipline means the audio forwarding loop in `openai_bridge.py` can concurrently decode incoming Twilio audio, re-encode it, and forward it to OpenAI Realtime without a thread pool or worker queue.

### Managed Services Over Self-Hosted

A medical voice assistant has to be reliable first and cheap second. Running a self-hosted Qdrant instance, a self-managed Postgres cluster, and a custom WebRTC TURN server would each add operational surface area with no product differentiation. Instead, the project delegates infrastructure concerns to managed services: Qdrant Cloud handles vector indexing and replication; a standard Postgres container (or any managed Postgres in production) handles relational persistence; Twilio handles PSTN connectivity, number provisioning, and codec negotiation; and Vapi handles WebRTC, STT, and TTS for the browser path. The application code is therefore almost entirely business logic — triaging symptoms, routing agents, extracting memories — rather than infrastructure glue. This is the correct trade-off for a product-focused project and the correct answer to give in an interview when asked "how would you scale this?"
