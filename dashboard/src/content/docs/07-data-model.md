# Data Model

Every SQLAlchemy model in the MediCall AI backend. All models use the SQLAlchemy 2.0 `Mapped[]` typing API via `mapped_column`.

## Patient

**File:** `backend/app/models/patient.py`

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, default uuid4 | |
| phone | String(32) | unique, indexed, not null | E.164 format |
| name | String(255) | nullable | Captured during first call |
| medical_context | JSONB | default `{}` | Flexible bag of allergies/conditions/medications |
| created_at | DateTime(tz) | server_default=now() | |
| updated_at | DateTime(tz) | onupdate=now() | |

**Relationships:**
- `calls` — 1→N to `Call`, `cascade="all, delete-orphan"`
- `appointments` — 1→N to `Appointment`, `cascade="all, delete-orphan"`

**Why JSONB for medical_context?** Allergies, chronic conditions, and current medications are open-ended lists that would otherwise require 3 extra tables. JSONB lets us query (`medical_context->'allergies' ? 'penicillin'`) without a schema migration every time we want a new tag type.

## Call

**File:** `backend/app/models/call.py`

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK | |
| call_sid | String(128) | unique, indexed | Twilio/Vapi call identifier |
| patient_id | UUID | FK → patients.id | |
| status | ENUM | RINGING, ACTIVE, COMPLETED, FAILED | |
| current_agent | String(32) | default "triage" | Live pointer to active agent |
| started_at | DateTime(tz) | | |
| ended_at | DateTime(tz) | nullable | Set on stop event |
| duration_seconds | Integer | nullable | Computed at call end |

**Relationships:**
- `patient` — N→1 back to `Patient`
- `transcript_entries` — 1→N to `TranscriptEntry`, cascade delete
- `summary` — 1→1 to `CallSummary`, cascade delete (back_populates)

**Status machine:** `RINGING → ACTIVE → COMPLETED` on success; `RINGING → FAILED` if OpenAI refuses or the stream drops.

## TranscriptEntry

**File:** `backend/app/models/transcript.py`

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| call_id | UUID | FK → calls.id, indexed |
| role | ENUM | PATIENT, AGENT, SYSTEM |
| content | Text | not null |
| agent_name | String(32) | nullable (only for AGENT rows) |
| timestamp | DateTime(tz) | indexed |

**SYSTEM rows** are used for internal events like "Routed from triage to scheduling" — they show up in the dashboard as gray italicized lines to give staff context on handoffs.

**Indexing:** Composite index on (call_id, timestamp) enables fast ordered retrieval of a single call's transcript.

## CallSummary

**File:** `backend/app/models/summary.py`

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| call_id | UUID | FK → calls.id, unique |
| summary_text | Text | 2-3 sentence narrative from GPT-4o-mini |
| extracted_symptoms | JSONB | list of strings |
| urgency_level | ENUM | LOW, MEDIUM, HIGH, CRITICAL |
| recommended_actions | JSONB | list of strings |
| created_at | DateTime(tz) | |

**Generation:** `backend/app/services/summary_svc.py` calls OpenAI `gpt-4o-mini` with `response_format={"type": "json_object"}` after the call ends. The structured JSON schema is enforced via the system prompt and validated before insert.

## Appointment

**File:** `backend/app/models/appointment.py`

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| patient_id | UUID | FK → patients.id, indexed |
| doctor_name | String(255) | not null |
| scheduled_at | DateTime(tz) | not null |
| status | ENUM | PENDING, CONFIRMED, CANCELLED, COMPLETED |
| notes | Text | nullable |
| created_at | DateTime(tz) | |

**Why `doctor_name` as a string (not FK to Doctor)?** Historical — Appointments predate the Doctor table. Migrating to a proper FK is in the backlog; for now the AI can book against any doctor name the caller provides. Doctor profiles are separately managed for semantic search.

## Doctor

**File:** `backend/app/models/doctor.py`

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |
| name | String(255) | |
| specialization | String(255) | |
| phone | String(32) | nullable |
| email | String(255) | nullable |
| available_days | JSONB | list of weekday names |
| available_hours | String(64) | e.g. "09:00-17:00" |
| bio | Text | nullable |
| is_active | Boolean | default True |
| created_at | DateTime(tz) | |

**Qdrant sync:** Every `create_doctor` and `update_doctor` REST call fires an `asyncio.create_task(upsert_doctor(...))` that writes the doctor profile to Qdrant's `doctor_directory` collection for semantic search by TriageAgent and SchedulingAgent.

## ERD

```
┌─────────────┐      1    N   ┌─────────────┐      1    N   ┌──────────────────┐
│   Patient   │───────────────▶│    Call     │───────────────▶│ TranscriptEntry  │
│             │                │             │                │                  │
│ id (PK)     │                │ id (PK)     │                │ id (PK)          │
│ phone       │                │ call_sid    │                │ call_id (FK)     │
│ name        │                │ patient_id  │                │ role             │
│ medical_ctx │                │ status      │                │ content          │
└──────┬──────┘                │ duration    │                │ timestamp        │
       │ 1                     └──────┬──────┘                └──────────────────┘
       │                              │ 1
       │ N                            │ 1
       ▼                              ▼
┌─────────────┐                ┌─────────────┐
│ Appointment │                │ CallSummary │
│             │                │             │
│ patient_id  │                │ call_id     │
│ doctor_name │                │ summary     │
│ scheduled   │                │ urgency     │
│ status      │                │ symptoms[]  │
└─────────────┘                └─────────────┘

┌─────────────┐
│   Doctor    │   (standalone; synced to Qdrant for semantic search)
│             │
│ name        │
│ specialty   │
│ avail_days  │
└─────────────┘
```

## Cascade Deletes

Deleting a `Patient` cascades to all `Call` rows (and transitively all `TranscriptEntry` and `CallSummary` rows) and all `Appointment` rows. This was a deliberate choice — a patient's removal from the system should erase their history, not leave orphan records. This pattern is easier to reason about for GDPR-style data-subject requests.

## Alembic Migrations

Two migrations live in `backend/alembic/versions/`:
1. `initial.py` — creates patients, calls, transcript_entries, call_summaries, appointments
2. `add_doctors.py` — adds the doctors table (created after the first hackathon iteration)

Run with `alembic upgrade head` inside the backend container.
