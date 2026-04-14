# Architecture Q&A

Whiteboard-style design questions. Each one starts from MediCall AI's current architecture and extends it.

## 1. Design a multi-tenant voice AI platform

**Prompt:** "MediCall AI works for one clinic. Design a multi-tenant version where each clinic has its own phone numbers, agent prompts, doctor list, and patient database — but all share the same backend codebase."

**Reference answer:**

The simplest model is a `clinic_id` foreign key on every table. The Patient, Call, Doctor, Appointment, and CallSummary tables all gain a `clinic_id` column with a not-null constraint. Every query is scoped by clinic_id, ideally enforced at the SQLAlchemy level via a query-rewriting hook or a custom base class so developers can't accidentally write cross-clinic queries. The Twilio webhook uses the called number (`To` field) to look up which clinic it belongs to, establishes the clinic context, and from that point forward every DB operation automatically carries the clinic_id.

For agent prompts, add a `clinic_prompt_overrides` table with `(clinic_id, agent_name, system_prompt_text)`. `BaseAgent.get_system_prompt()` checks for an override before falling back to the default template. This lets each clinic customize tone, available services, hours, and routing rules through the dashboard UI without any code changes.

Doctor lists and Qdrant collections need namespacing too. For Qdrant, add a `clinic_id` payload filter on every search — the same way we already filter by `patient_id` for memory. Each clinic's doctor directory is logically isolated even though it shares a physical collection. For Postgres, use PostgreSQL's row-level security policies as a defense-in-depth layer on top of application-level scoping.

Phone number routing: maintain a `clinic_phone_numbers` table mapping Twilio numbers to clinic_ids. The webhook looks this up first to establish context. For outbound calls (reminders, emergency alerts), use the clinic's purchased Twilio number so the patient sees the clinic's caller ID.

Billing: track call duration and OpenAI token usage per clinic_id in a `usage_events` table and bill monthly via Stripe's usage-based billing API. The metering row is written at the end of `_finalize_call`. Each clinic gets a usage dashboard in their admin panel.

Hard parts: shared OpenAI rate limits (one busy clinic could starve others — use per-clinic token quotas enforced before opening an OpenAI session), shared Twilio account (use Twilio subaccounts for billing isolation and to prevent one clinic's number from appearing in another's logs), and clinic onboarding flow (provision phone numbers, configure Twilio webhooks, seed default prompts, create the admin user, run the doctor import wizard).

---

## 2. Design a call replay system

**Prompt:** "When a call goes wrong, we want to replay it through the system to debug. Design the storage and playback architecture."

**Reference answer:**

**Recording layer:** Hook into the Twilio MediaStream WebSocket handler and write every inbound audio frame to a per-call file in S3 with key `calls/<call_sid>/inbound.mulaw`. Record every OpenAI Realtime event (both sent and received) to `calls/<call_sid>/events.jsonl`, one JSON object per line, each with a `direction` field (sent/received) and a `wall_clock_ms` offset from call start. Both files upload asynchronously after the call ends using `asyncio.create_task` so they don't impact live call latency. Default retention is 30 days with a lifecycle rule to Glacier after that.

**Two replay modes:**

*Audio fidelity mode* — uses the recorded mulaw audio plus a live OpenAI connection to test whether new code changes alter the AI's behavior on a known call. The harness sends audio frames at the original cadence (using the timestamp offsets from the JSONL file as delays). A side-by-side diff of the new event log against the reference log shows where behavior diverged.

*Event replay mode* — stubs both the Twilio WebSocket and the OpenAI connection entirely. It replays the recorded OpenAI events through `_handle_event` as if they came from the live API. This lets you test all downstream logic (transcript batching, agent routing, summary generation, Qdrant upserts) deterministically without any network calls. Fastest iteration cycle for backend bugs.

**Replay CLI:** `python scripts/replay_call.py <call_sid> --mode=event|audio` downloads the S3 artifacts, spins up the harness, and either prints a diff report or dumps the new event log for inspection.

The trickiest part is timing fidelity in audio mode. If you replay too fast you overwhelm the OpenAI WebSocket input buffer; too slow and the model thinks there are long pauses. The safest approach is to use the frame timestamps from the JSONL to throttle sends to the original real-time rate with a configurable speedup multiplier (e.g., `--speed=2.0` for 2x replay speed).

---

## 3. Design doctor availability with recurring schedules

**Prompt:** "The current Doctor model has `available_days` (a JSON array of weekday names) and `available_hours` (a string like '09:00-17:00'). Design a richer model that supports recurring schedules, exceptions (vacation, conferences), and one-off blocked slots."

**Reference answer:**

Three new tables:

**`doctor_schedule_rules`** — recurring weekly availability:
- `id`, `doctor_id`, `weekday` (0–6, where 0=Monday), `start_time` (TIME), `end_time` (TIME), `slot_duration_minutes` (default 30), `effective_from` (DATE), `effective_until` (DATE nullable)
- A doctor can have multiple rows per weekday (morning 09:00–12:00 + afternoon 14:00–17:00)

**`doctor_schedule_exceptions`** — overrides for specific calendar dates:
- `id`, `doctor_id`, `date` (DATE), `available` (BOOLEAN), `start_time` (TIME nullable), `end_time` (TIME nullable), `reason` (varchar nullable)
- A vacation day is a row with `available=false` and no times. A conference day with partial hours is `available=true` plus custom times. A one-off extra slot on an otherwise off day is also `available=true`.

**`doctor_appointments`** — actual booked slots (the existing Appointment table, already tied to doctor_id + datetime).

**Availability algorithm for a given date:**
1. Query `schedule_rules` where `weekday = date.weekday()` AND `effective_from <= date` AND (`effective_until IS NULL` OR `effective_until >= date`). Union the resulting time windows into a base availability set.
2. Apply `schedule_exceptions` for the exact date: if any exception has `available=false`, the doctor is fully unavailable that day (return empty). If `available=true` with custom hours, replace the base availability with those hours.
3. Generate the slot list by stepping through the availability windows in `slot_duration_minutes` increments.
4. Subtract any existing `appointments` that fall within those slots (checking for overlap, not just start time equality).
5. Return remaining open slots as `[(start_time, end_time), ...]`.

SchedulingAgent's `check_availability(doctor_id, date_range)` calls this logic for each requested date and returns the first 5 open slots. The TriageAgent's `find_doctor` Qdrant search still returns doctor profiles based on specialty — the availability check is a second step. Doctor profiles in Qdrant are re-embedded when their specialty or bio changes, but schedule changes don't trigger re-embedding because they're structured data, not semantic content.

---

## 4. Design call escalation to a human

**Prompt:** "Sometimes the AI gets stuck and the patient needs a human. Design a system that detects this and transfers the call to an on-call clinician."

**Reference answer:**

**Detection signals — three triggers:**

1. *Patient request* — TriageAgent's tool list includes a `request_human_handoff` tool with no parameters. The model is instructed to call it when the patient says phrases like "let me speak to a human", "I want to talk to someone real", or "I need a doctor now." This is the most reliable signal because it's explicit.

2. *AI loop detection* — a turn counter in `CallSession` increments each time the AI speaks. If the counter exceeds 10 turns without any tool call resolving the patient's need (no appointment booked, no urgency assessed, no question answered), the session automatically surfaces a handoff offer to the caller.

3. *Critical urgency without location* — if EmergencyAgent can't collect the caller's address within 3 turns (they're confused, panicking, or non-responsive), escalate to human immediately rather than looping.

**Transfer mechanism:** Twilio supports mid-call TwiML redirects. When handoff is triggered, we: (1) terminate the OpenAI Realtime session gracefully, (2) send a `POST /2010-04-01/Accounts/{sid}/Calls/{call_sid}` REST API call to Twilio with new TwiML: `<Response><Say>Connecting you to a clinician now.</Say><Dial>+1ONCALLNUMBER</Dial></Response>`. The on-call number comes from a `clinic_on_call_schedule` table that maps time windows to the clinician's personal cell.

**State capture before transfer:** Write the full transcript and an immediate GPT-4o-mini summary to the database synchronously (not fire-and-forget) before initiating the transfer. Then SMS the clinician: "Inbound transfer from +1xxx-xxx-xxxx. Patient concern: {summary_line}. Urgency: {level}. Full transcript: {dashboard_url}". The clinician picks up the call already knowing the context.

**Fallback when no human is available:** If the Dial attempt reaches voicemail or goes unanswered after 30 seconds, Twilio fires a callback to our `/api/twilio/dial-fallback` endpoint. We resume the call with: "We weren't able to connect you immediately. A clinician will call you back within 30 minutes. We've recorded your concern." Write a `callback_queue` row to the database so a staff member's dashboard shows it as a pending callback task.

---

## 5. Design real-time analytics — call volume, urgency, top symptoms

**Prompt:** "Build a live analytics dashboard that shows call volume, average urgency, and top symptoms for the past hour, updated every 30 seconds."

**Reference answer:**

**Three layers:**

*Aggregation layer:* A background `asyncio` task runs every 30 seconds and queries Postgres for:
- Call counts grouped by status for the last 1h, 24h, and 7d
- Average urgency score (numeric: low=1, medium=2, high=3, critical=4) for completed calls
- Top 10 symptom tokens extracted from `extracted_symptoms` JSONB across recent `CallSummary` rows using `jsonb_array_elements_text` + `GROUP BY`
- Per-agent call distribution (how many calls each agent handled as primary)

The aggregator writes results to a Redis hash `analytics:current` with a TTL of 5 minutes as a safety net. The task also writes a row to an `analytics_snapshots` table for durability — so if Redis is restarted we can recover the last snapshot from Postgres.

*API layer:* `GET /api/analytics/live` reads `analytics:current` from Redis and returns the JSON. This is nearly free — under 1ms round-trip. No Postgres hit on every poll. The endpoint also emits the same payload via Socket.IO to any connected dashboard clients when the aggregation task refreshes, so the frontend can use either polling or push.

*Frontend:* A new `AnalyticsLive.tsx` page with four Recharts components: a line chart for call volume over the last 24h (hourly buckets), a donut chart for urgency level distribution, a horizontal bar chart for top 10 symptoms, and a stat row showing active calls / avg call duration / escalation rate. The page subscribes to the Socket.IO `analytics_update` event and merges the new snapshot into local state.

For time ranges beyond 24h, use a Postgres materialized view `analytics_daily_summary` refreshed hourly by a pg_cron job. Querying raw call rows over weeks is too slow for a live endpoint. The frontend switches automatically: < 24h uses the Redis live snapshot, >= 24h queries the materialized view via a separate endpoint.

If Redis is unavailable, the `/api/analytics/live` endpoint falls back to a direct Postgres query with a 5-second cache via Python's `functools.lru_cache` — slightly slower but still acceptable for a 30-second polling interval.

---

## 6. Design "the AI learns from past calls"

**Prompt:** "Over time, we want the triage to get smarter — if 100 patients with chest pain ended up being heartburn, the AI should weight that. Design a feedback loop."

**Reference answer:**

The naive approach — RLHF + fine-tuning a custom OpenAI model — is expensive, slow (weeks per iteration), and requires a large labeled dataset. Instead, use retrieval-augmented prompting with a closed feedback loop, which can improve in near-real-time.

**Outcome tracking:** After each call, the post-call pipeline writes a `case_outcomes` record:
- `call_id`, `presenting_symptoms[]` (extracted from transcript), `assessed_urgency` (what the AI decided), `eventual_diagnosis` (nullable — filled in by clinic staff later), `patient_outcome` (resolved/escalated/callback/ER visit), `clinician_override` (nullable boolean — did a clinician change the urgency after reviewing?)

The `eventual_diagnosis` comes from clinic staff using the dashboard's "outcome entry" form when they follow up on the case — the loop closes when staff label outcomes. Even partial labels (just flagging AI errors) are valuable.

**Outcome-aware retrieval:** Add a `case_outcomes` Qdrant collection. Each record is embedded from `"symptoms: {symptoms_text} | urgency: {assessed_urgency} | outcome: {eventual_diagnosis}"`. When TriageAgent calls `assess_urgency(symptoms)`, we do two things: (1) the model reasons from its pre-training as usual, and (2) we do a Qdrant similarity search in `case_outcomes` filtered to the same clinic, retrieving the top 3 most similar past cases. We inject these into the TriageAgent's context as: "Similar past cases from this clinic: [Case 1: chest tightness, initially assessed high urgency, eventual diagnosis: GERD, resolved without ER — 94% similar]. Use these as reference data but apply your own judgment." The LLM gains concrete priors without weight updates.

**Drift monitoring:** A weekly background job computes two metrics per agent: (a) urgency calibration — what % of "high" assessments led to actual high-urgency outcomes (precision), and (b) escalation recall — what % of true emergencies were correctly flagged "critical" (recall). If recall drops below 95% for EmergencyAgent, automatically page the clinic administrator and freeze updates to that agent's prompts until a human review. For TriageAgent, a 5% drift in calibration triggers a prompt review suggestion in the admin dashboard.

**Long-term fine-tuning path:** Once the outcome dataset exceeds ~5,000 labeled cases, prepare a fine-tuning dataset: `(system_prompt, conversation, final_tool_call_sequence)` triples. Fine-tune a GPT-4o-mini model via the OpenAI fine-tuning API. This smaller, specialized model handles triage more cheaply and accurately than the base model. The fine-tuning pipeline should be versioned — every model version is tied to the dataset snapshot it was trained on, and rollback is a one-line config change.
