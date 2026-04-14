# Post-Call Pipeline

Everything that happens after the patient hangs up.

## The Chain

```
Twilio "stop" event
       │
       ▼
_finalize_call()                  — mark Call COMPLETED, compute duration, close OpenAI WS
       │
       ▼
asyncio.create_task(
  _post_call_pipeline()           — fire-and-forget background task
)
       │
       ├──▶ summary_svc.generate_summary(call_id)
       │       │
       │       └──▶ asyncio.create_task(
       │              _consolidate_memory(patient_id, call_id)
       │                                — extracts up to 5 facts
       │                                  → Qdrant patient_memory
       │            )
       │
       ├──▶ notification_svc.send_post_call_sms(call_id)
       │       — Twilio SMS to patient with summary + next steps
       │
       └──▶ sheets_sync.push_call_summary(call_id)
               — Google Sheets export (optional, no-op if unconfigured)
```

## Why Async / Fire-and-Forget?

Two reasons:

1. **Free up the WebSocket handler immediately.** When a call ends, the Twilio MediaStream WebSocket needs to close cleanly so we can accept the next call. Blocking on summary generation (which calls OpenAI and can take 5-15 seconds) would delay the next caller's experience.

2. **Failures must not affect the call.** If OpenAI is having an outage or Qdrant is down, the call still happened — it should appear in the database with `status=COMPLETED`. The summary just won't get generated. The pipeline is wrapped in try/except at every stage.

## Background Task GC Pitfall

Python's `asyncio.create_task` returns a Task object. If you don't keep a reference to it, the garbage collector may collect it before it finishes — silently dropping the work. This is a known Python footgun documented in [PEP 461](https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task).

The fix is to keep references in a module-level `set`:

```python
_background_tasks: set[asyncio.Task] = set()

def _spawn_post_call(call_id):
    task = asyncio.create_task(_post_call_pipeline(call_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
```

This is used in `twilio_stream.py` for the post-call pipeline and the delayed-hangup task.

## DetachedInstanceError Defense

Inside `summary_svc.generate_summary()`, we load the Call inside a `db_session` block, then close the session, then make the OpenAI call (which takes seconds). When we open a new session to insert the CallSummary, we need `call.patient_id` — but the original `call` ORM object is now detached.

The fix is to **capture scalar values inside the session block** before closing it:

```python
async with db_session() as db:
    result = await db.execute(
        select(Call).where(Call.id == call_id).options(selectinload(Call.transcript_entries))
    )
    call = result.scalar_one_or_none()
    transcript = "\n".join(...)
    patient_id = call.patient_id   # ← capture before session close
```

Then `patient_id` (a plain UUID) is used in the second session block.

## Memory Consolidation Detail

`memory_svc.consolidate(patient_id, call_id, transcript_text)` is what extracts facts from the transcript:

1. Sends the transcript + extraction prompt to `gpt-4o-mini` with `response_format={"type": "json_object"}`
2. Parses `{memories: [{text, type}, ...]}`
3. Caps at 5 facts (more than that is noise)
4. Each fact becomes a Qdrant point in `patient_memory` with metadata `{type, call_id}` and a deterministic MD5-derived ID

The `type` field is one of: `symptom | medication | condition | appointment | preference`.

## SMS Notification

`notification_svc.send_post_call_sms()` builds a body like:

> Hi Jane! Your call with MediCall AI has been completed. Summary: ... Next steps: ... Reply STOP to opt out.

Sent via Twilio SMS to the patient's phone. No-op if Twilio isn't configured.

## Google Sheets Export

`sheets_sync.push_call_summary()` appends a row with timestamp, patient name, urgency, summary, and recommended actions. Useful for staff who want to filter and review calls without logging into the dashboard.
