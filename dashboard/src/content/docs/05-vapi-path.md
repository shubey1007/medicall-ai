# The Vapi Alternative Path

MediCall AI has two ways a voice call can enter the system: **Twilio** (production) and **Vapi** (demo + multilingual).

---

## Why Have Two Paths?

The Twilio path gives us complete ownership of the audio pipeline. Twilio hands us raw µ-law audio over a WebSocket media stream, and we control every byte: the codec transcoding, the OpenAI Realtime session configuration, the VAD settings, and the exact moment audio is forwarded or muted. This level of control is necessary in a production medical context where we need deterministic behavior, full logging, HIPAA-aligned data handling, and the ability to inject custom audio (hold music, compliance disclaimers) at any point in the call. Twilio's phone number infrastructure is also battle-tested for reliability — 99.95% uptime SLA, carrier-grade PSTN routing, and support for every phone type including landlines and VoIP.

The Vapi path solves a different problem: getting a working demo in front of judges and stakeholders quickly, without requiring a phone. Vapi is a managed voice AI platform that wraps Twilio, STT (Deepgram), TTS (ElevenLabs or Azure), and LLM routing behind a single API call. It ships a Web SDK that establishes a WebRTC audio session directly from a browser tab using Daily.co rooms — no phone number, no SIM card, no mobile device required. Vapi also supports multilingual Deepgram transcription out of the box (`nova-2` model with language auto-detection), which lets us demonstrate the assistant handling Spanish or French callers without writing any transcription code ourselves. The tradeoff is that we have less control: we cannot directly touch the audio stream, cannot inject audio mid-call, and are billed per-minute by Vapi. For a hackathon demo these tradeoffs are entirely acceptable.

---

## serverUrl Webhook Mode

Vapi supports a "bring your own LLM" pattern via the `serverUrl` field. Rather than Vapi managing a built-in assistant configuration statically, Vapi POSTs to our FastAPI server at key moments in a call's lifecycle. Our server responds with the configuration Vapi should use for that specific call — system prompt, tool definitions, voice, transcriber settings — computed dynamically based on the caller's phone number or session context.

This is architecturally important: it means the same four-agent system (TriageAgent, SchedulingAgent, MedicationAgent, EmergencyAgent) that powers the Twilio path also powers the Vapi path. The agent logic lives in one place (`backend/app/agents/`); the path through the system is just a different transport layer.

---

## Two Endpoints

**`POST /api/vapi/webhook`** — handles call lifecycle events:

- **`assistant-request`** — fired at the start of a call. We call `build_assistant_config()` from `vapi_session_svc.py`, which builds a Vapi-formatted assistant config using TriageAgent's system prompt and tool list, and returns it in the response body. Vapi uses this config for the duration of the call unless we update it.
- **`status-update`** — fired as the call transitions between states (`ringing`, `in-progress`, `ended`). We log each transition. On `ended` we pop the `call_id` entry from the `_call_agents` dict to free memory.
- **`end-of-call-report`** — fired after the call ends with a complete transcript. We pass the transcript to `memory_svc.consolidate()` to extract and store patient memories in Qdrant, mirroring what the Twilio post-call pipeline does.

**`POST /api/vapi/tool-call`** — handles function invocations. When the LLM decides to call a tool, Vapi POSTs to this endpoint with `{message: {functionCall: {name, parameters}}}`. Our handler:

1. Reads `call_id` from the request to identify which call this tool invocation belongs to.
2. Looks up the current agent name from `_call_agents[call_id]`, defaulting to `"triage"` if the call is new.
3. Special-cases `route_to_agent`: if the tool name is `route_to_agent`, we update `_call_agents[call_id]` to the new agent name and return early with a routing acknowledgment. There is no `session.update` to fire here because Vapi manages the LLM session — we just update our own state so the next tool call is dispatched to the right agent.
4. For all other tools, retrieves the agent instance from `_agent_registry`, constructs a `_MockSession`, and calls `agent.handle_tool_call(tool_name, arguments, mock_session)`.
5. Returns `{result: json.dumps(result)}` — Vapi injects this string as the function call output and prompts the LLM to continue.

---

## In-Memory State

The Vapi path is intentionally stateless from a database perspective during the call. Two module-level dicts manage runtime state:

- **`_call_agents: dict[str, str]`** — maps a Vapi `call_id` to the name of the currently active agent (`"triage"`, `"scheduling"`, etc.).
- **`_agent_registry: dict[str, BaseAgent]`** — pre-instantiated agent objects keyed by name. Agents are singletons for the Vapi path because they carry no per-call state; the session context is passed in on every `handle_tool_call` invocation.

A **`_MockSession`** class provides the minimal interface that `BaseAgent.handle_tool_call()` requires: `patient_id`, `patient_phone`, `call_sid`, and `current_agent`. In the demo path, `patient_id` is `None` because we have no way to look up a patient from a WebRTC browser session without a real phone number. All agent tool handlers that query patient-specific data (e.g., `recall_patient_memory` in TriageAgent, `lookup_appointments` in SchedulingAgent) guard against `patient_id is None` and return empty or placeholder results rather than crashing.

---

## Browser Demo (Vapi Web SDK)

**File:** `dashboard/src/pages/DemoCall.tsx`

The dashboard includes a `/demo` route that uses `@vapi-ai/web` to let anyone call the AI from a browser tab over WebRTC — no phone required.

1. The user clicks "Start Demo Call".
2. `vapiRef.current.start(ASSISTANT_CONFIG)` initializes the SDK with an inline assistant config object (bypassing the serverUrl webhook for the demo path — the config is provided directly to the SDK rather than fetched from our server).
3. Vapi creates a Daily.co WebRTC room, requests microphone permission from the browser, and starts the voice loop.
4. The page subscribes to five SDK events:
   - `call-start` — updates UI state to "connected"
   - `call-end` — resets UI state
   - `volume-level` — drives a real-time audio visualizer bar
   - `message` — receives transcript messages; final transcripts (`message.type === "transcript" && message.transcriptType === "final"`) are appended to the live transcript panel; partials are filtered out to avoid flickering
   - `error` — surfaces error messages to the user

**Key Vapi assistant config format:**

```typescript
{
  name: "MediCall AI Demo",
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: "..." }],
    temperature: 0.7
  },
  voice: { provider: "11labs", voiceId: "burt" },
  transcriber: { provider: "deepgram", model: "nova-2", language: "en-US" },
  firstMessage: "Hello! I'm MediCall AI..."
}
```

**Gotcha:** The `model.messages` array must use `[{role: "system", content: "..."}]` — **not** the older top-level `systemPrompt` string field. If you use `systemPrompt`, Vapi silently ignores it, the model has no instructions, and the call fails with a "Meeting has ended / ejected" WebRTC disconnect error that looks like a network problem. This cost roughly two hours of debugging. The correct field is `model.messages`.

---

## Vapi vs Twilio Path — Quick Comparison

| Dimension | Twilio Path | Vapi Path |
|-----------|-------------|-----------|
| Entry point | `POST /twilio/incoming` → TwiML | `POST /api/vapi/webhook` (assistant-request) |
| Audio control | Full (raw µ-law WebSocket) | None (Vapi-managed) |
| STT | OpenAI Whisper-1 (via Realtime API) | Deepgram nova-2 |
| TTS | OpenAI Realtime alloy voice | ElevenLabs burt |
| LLM | gpt-4o-realtime-preview | gpt-4o-mini |
| Agent routing | `session.update` to OpenAI mid-call | `_call_agents` dict update |
| Session state | `CallSession` dataclass + `CallManager` | `_call_agents` + `_MockSession` |
| Demo-able from browser | No | Yes (WebRTC via Daily.co) |
| Post-call memory | Full pipeline (summary + Qdrant + SMS + Sheets) | `memory_svc.consolidate()` only |
