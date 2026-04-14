# Multi-Agent System

The core of MediCall AI's behavior is a system of four specialized agents that share a common interface and can hand off control mid-call.

---

## Why Multiple Agents?

One mega-prompt containing all tools — appointment scheduling, medication lookup, emergency escalation, and triage — would be expensive, slow, and unreliable. The OpenAI Realtime API charges per audio token and per output token; a session with 15+ tools defined means the model evaluates a much larger context on every turn. More importantly, a broad system prompt creates ambiguity: the model must figure out which domain it is currently operating in before it can decide what to do, which introduces hesitation and hallucination risk. In a voice interaction where silence or an incorrect response can cause patient harm, that is unacceptable.

Specialized agents with narrow prompts and minimal tool surfaces are faster, cheaper, and more predictable. SchedulingAgent has exactly the tools needed to book appointments and nothing else — it cannot accidentally give medication advice because it does not have a medication tool. The OpenAI Realtime API's `session.update` event lets us swap both the system prompt and the available tool list mid-call without losing conversation context. All prior messages remain in the session; we are only changing what the model is allowed to do from that point forward. This is the key mechanism that makes multi-agent routing viable on a single Realtime session rather than requiring separate API connections.

---

## BaseAgent Interface

**File:** `backend/app/agents/base.py`

```python
class BaseAgent(ABC):
    name: str
    description: str

    @abstractmethod
    def get_system_prompt(self) -> str: ...

    @abstractmethod
    def get_tools(self) -> list[dict]: ...

    @abstractmethod
    async def handle_tool_call(
        self, tool_name: str, arguments: dict, session: CallSession
    ) -> dict: ...

    def should_route(self, tool_name: str) -> tuple[bool, str | None]: ...
```

Every agent subclasses `BaseAgent` and implements the three abstract methods. `get_system_prompt()` returns the raw string that is sent in the `session.update` `instructions` field. `get_tools()` returns a list of OpenAI function-schema dicts (`name`, `description`, `parameters` with JSON Schema). `handle_tool_call()` is the dispatch method that receives a tool invocation, performs the underlying business logic (DB query, external API, etc.), and returns a result dict that gets JSON-serialized and sent back to OpenAI as a `function_call_output`.

The `should_route` helper is a shared concrete method on the base class. It checks whether `tool_name == "route_to_agent"` and, if so, returns `(True, arguments["agent_name"])`. Every subclass inherits this without overriding — routing logic is uniform across all agents.

---

## Shared Tools

Two tools are available to all four agents and are defined once in `backend/app/agents/shared_tools.py` then included in each agent's `get_tools()` return value.

**`ROUTE_TO_AGENT_TOOL`** — Enables any agent to transfer control to another. The model calls this with `{agent_name: "scheduling"}` (or `"medication"`, `"emergency"`, `"triage"`). Our handler in `twilio_stream.py` detects this tool name via `should_route()`, instantiates the target agent, sends `session.update` to OpenAI, and updates `session.current_agent`. The old agent instance is dereferenced and garbage collected.

**`END_CALL_TOOL`** — Enables any agent to wrap up the call gracefully rather than leaving the patient on a silent line. When the model invokes this tool, the handler first returns an acknowledgment result (so OpenAI can generate a farewell), then `await asyncio.sleep(6)` to allow the synthesized farewell audio to finish playing, and finally calls the Twilio REST API (`client.calls(call_sid).update(status="completed")`) to terminate the call server-side.

---

## The Four Agents

| Agent | Role | Tools |
|-------|------|-------|
| **TriageAgent** | First contact; greets, collects symptoms, decides where to route | `assess_urgency`, `lookup_patient`, `recall_patient_memory`, `find_doctor`, `route_to_agent`, `end_call` |
| **SchedulingAgent** | Books, reschedules, and cancels appointments | `check_availability`, `book_appointment`, `cancel_appointment`, `find_doctor`, `route_to_agent`, `end_call` |
| **MedicationAgent** | Answers medication questions (NEVER prescribes) | `lookup_medication_info`, `search_medical_knowledge`, `route_to_agent`, `end_call` |
| **EmergencyAgent** | Activated on critical symptoms; directs to 911 and notifies on-call staff | `trigger_emergency_alert`, `route_to_agent`, `end_call` |

Every agent's system prompt begins with: **"Always respond in English, regardless of the language the caller uses."** This line was added after a production bug where OpenAI's language auto-detection caused the model to reply in Spanish to a bilingual caller, bypassing all of our tested response patterns and confusing the routing logic. The explicit override locks response language without affecting transcription or comprehension.

---

## Routing Mechanism (Mid-Call Handoff)

When TriageAgent determines the caller wants to book an appointment, it invokes `route_to_agent({"agent_name": "scheduling"})`. The complete flow:

1. `_handle_tool_call()` in `twilio_stream.py` reads `session.current_agent` (`"triage"`), retrieves the `TriageAgent` instance, and calls `triage_agent.handle_tool_call("route_to_agent", {"agent_name": "scheduling"}, session)`. The agent returns `{status: "routing", target: "scheduling"}`.
2. Back in `_handle_tool_call()`, we call `agent.should_route("route_to_agent")` which returns `(True, "scheduling")`. The routing branch executes.
3. We instantiate `SchedulingAgent()`.
4. `bridge.update_session(scheduling_agent)` is called. Internally this sends a `session.update` event to the live OpenAI Realtime WebSocket with SchedulingAgent's system prompt in `instructions` and SchedulingAgent's 6 tools in the `tools` array. TriageAgent's tools are no longer present.
5. `session.current_agent = "scheduling"` is updated so all subsequent tool dispatches go to SchedulingAgent.
6. A `TranscriptEntry` with `role=SYSTEM` and text `"Routed from triage to scheduling"` is saved to Postgres, making the handoff visible in post-call summaries and the dashboard transcript viewer.
7. A `call:agent_changed` Socket.IO event is emitted to the dashboard. The live call monitor updates the agent badge from "TRIAGE" to "SCHEDULING" in real time.

**Key insight:** The OpenAI Realtime session is NOT restarted. All prior conversation messages are preserved in the session context — `session.update` only patches `instructions` and `tools`, leaving `conversation.items` untouched. SchedulingAgent can reference everything the caller said to TriageAgent (e.g., "the caller already mentioned they need a follow-up for their knee") without us having to explicitly pass a conversation summary.

---

## Safety Guardrails

**MedicationAgent NEVER prescribes.** The system prompt contains an explicit hard prohibition: "You are not a prescriber. Under no circumstances should you recommend a specific dosage, prescribe a medication, or advise the caller to change their current prescription. Provide only general educational information." The `lookup_medication_info` tool returns FDA-sourced general drug information; the `search_medical_knowledge` tool queries a Qdrant collection of medical reference documents. Neither tool returns prescription recommendations — the data itself cannot produce them.

**EmergencyAgent always directs to 911.** The system prompt mandates that the first spoken action when `EmergencyAgent` becomes active is to tell the caller to call 911 if they are in immediate danger. The agent cannot be used as a substitute for emergency services — `trigger_emergency_alert` notifies on-call staff in parallel, but the tool result always includes the instruction: "Tell the patient to call 911 immediately."

**All agents refuse personal medical advice.** Every agent's system prompt includes a fallback instruction: "If asked for personalized medical advice, diagnosis, or treatment decisions, respond with 'I'm not able to provide medical advice — please consult your doctor or visit an urgent care clinic.'" This prevents the model from attempting to diagnose based on symptoms even if it has no specific tool to misuse.

---

## Why Separate Agents Instead of One Big Prompt?

Consider what a monolithic approach would look like: one system prompt covering clinic hours, appointment policies, medication disclaimers, emergency protocols, triage guidelines, and memory recall — plus all 15+ tools defined simultaneously. At every turn of the conversation, OpenAI must process the entire tool list to decide whether any tool is relevant. The context window cost is higher, the inference is slower, and the probability of the model selecting the wrong tool increases with the number of tools available.

The multi-agent model is effectively a **state machine**. Each state is an agent; each agent encapsulates a role with a tightly scoped prompt and a minimal tool surface. When TriageAgent is active, the model can see exactly 6 tools. When the call routes to SchedulingAgent, the tool surface changes entirely — appointment-related tools appear and triage tools disappear. The model never has to reason about whether `trigger_emergency_alert` is relevant when it is booking a follow-up appointment, because that tool simply does not exist in that state.

This design also improves debuggability. If SchedulingAgent misbehaves, we can test it in isolation with a mock session and specific arguments — there is no shared prompt state that could cause triage logic to bleed into scheduling behavior.

---

## Emergency Escalation

When EmergencyAgent fires `trigger_emergency_alert`, the handler executes two actions in parallel:

1. Calls the Twilio REST client to send an SMS to the clinic's configured on-call phone number. The SMS body includes: patient phone number, summarized symptoms (passed as `arguments["symptoms"]`), assessed severity level (`arguments["severity"]`), and any location information the patient provided.
2. Creates a `Call` flag in Postgres marking the call as `escalated=True` so it appears in the dashboard's emergency queue with a red indicator.

This happens concurrently with the agent verbally instructing the patient to call 911, so by the time the agent finishes speaking the SMS has already been dispatched to on-call staff.
