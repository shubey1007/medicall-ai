"""Seed the database with realistic test data for development."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.database import db_session
from app.models import (
    Patient, Call, CallStatus, TranscriptEntry, TranscriptRole,
    Appointment, AppointmentStatus, CallSummary, UrgencyLevel,
)


async def seed() -> None:
    async with db_session() as session:
        # Patients
        p1 = Patient(phone="+917098213317", name="Shubham Kumar Sharma",
                     medical_context={"allergies": ["penicillin"], "conditions": ["asthma"]})
        p2 = Patient(phone="+15551001002", name="Bob Martinez",
                     medical_context={"conditions": ["hypertension"], "medications": ["lisinopril"]})
        p3 = Patient(phone="+15551001003", name="Carol Jensen", medical_context={})
        session.add_all([p1, p2, p3])
        await session.flush()

        now = datetime.now(timezone.utc)

        # Call 1 — Alice, completed, booking
        c1 = Call(call_sid="CA_seed_001", patient_id=p1.id, status=CallStatus.COMPLETED,
                  current_agent="scheduling",
                  started_at=now - timedelta(hours=3),
                  ended_at=now - timedelta(hours=3) + timedelta(minutes=4),
                  duration_seconds=240)
        session.add(c1)
        await session.flush()

        session.add_all([
            TranscriptEntry(call_id=c1.id, role=TranscriptRole.AGENT, agent_name="triage",
                            content="Hello, thank you for calling MediCall. How can I help you today?",
                            timestamp=now - timedelta(hours=3)),
            TranscriptEntry(call_id=c1.id, role=TranscriptRole.PATIENT,
                            content="I'd like to book an appointment with Dr. Smith.",
                            timestamp=now - timedelta(hours=3, seconds=-8)),
            TranscriptEntry(call_id=c1.id, role=TranscriptRole.SYSTEM,
                            content="Routing to SchedulingAgent",
                            timestamp=now - timedelta(hours=3, seconds=-12)),
            TranscriptEntry(call_id=c1.id, role=TranscriptRole.AGENT, agent_name="scheduling",
                            content="I can help with that. Dr. Smith has an opening Thursday at 2pm.",
                            timestamp=now - timedelta(hours=3, seconds=-20)),
        ])
        session.add(CallSummary(
            call_id=c1.id,
            summary_text="Patient called to book a routine appointment with Dr. Smith.",
            extracted_symptoms=[],
            urgency_level=UrgencyLevel.LOW,
            recommended_actions=["Confirm appointment 24h before"],
        ))

        # Call 2 — Bob, completed, emergency
        c2 = Call(call_sid="CA_seed_002", patient_id=p2.id, status=CallStatus.COMPLETED,
                  current_agent="emergency",
                  started_at=now - timedelta(hours=1),
                  ended_at=now - timedelta(hours=1) + timedelta(minutes=2),
                  duration_seconds=120)
        session.add(c2)
        await session.flush()

        session.add_all([
            TranscriptEntry(call_id=c2.id, role=TranscriptRole.AGENT, agent_name="triage",
                            content="How can I help you today?",
                            timestamp=now - timedelta(hours=1)),
            TranscriptEntry(call_id=c2.id, role=TranscriptRole.PATIENT,
                            content="I'm having severe chest pain and shortness of breath.",
                            timestamp=now - timedelta(hours=1, seconds=-5)),
        ])
        session.add(CallSummary(
            call_id=c2.id,
            summary_text="Patient reported severe chest pain. Escalated to emergency.",
            extracted_symptoms=["chest pain", "shortness of breath"],
            urgency_level=UrgencyLevel.CRITICAL,
            recommended_actions=["Call 911 immediately", "Notify on-call cardiologist"],
        ))

        # Call 3 — Carol, completed, medication
        c3 = Call(call_sid="CA_seed_003", patient_id=p3.id, status=CallStatus.COMPLETED,
                  current_agent="medication",
                  started_at=now - timedelta(hours=6),
                  ended_at=now - timedelta(hours=6) + timedelta(minutes=3),
                  duration_seconds=180)
        session.add(c3)
        await session.flush()
        session.add(CallSummary(
            call_id=c3.id,
            summary_text="Patient asked about ibuprofen dosage.",
            extracted_symptoms=["mild headache"],
            urgency_level=UrgencyLevel.LOW,
            recommended_actions=["Follow standard OTC guidelines"],
        ))

        # Appointments
        session.add_all([
            Appointment(patient_id=p1.id, doctor_name="Dr. Smith",
                        scheduled_at=now + timedelta(days=2),
                        status=AppointmentStatus.CONFIRMED,
                        notes="Routine checkup"),
            Appointment(patient_id=p2.id, doctor_name="Dr. Patel",
                        scheduled_at=now + timedelta(days=5),
                        status=AppointmentStatus.PENDING,
                        notes="Follow-up on blood pressure"),
        ])

        await session.commit()

    print("\u2713 Seed complete: 3 patients, 3 calls, 6 transcript entries, 3 summaries, 2 appointments")


if __name__ == "__main__":
    asyncio.run(seed())
