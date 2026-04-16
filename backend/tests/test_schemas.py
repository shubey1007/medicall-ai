import pytest
from datetime import datetime, timezone
import uuid
from pydantic import ValidationError

from app.schemas import PatientCreate, AppointmentCreate


def test_patient_create_valid():
    p = PatientCreate(phone="+15551234567", name="Test", medical_context={"allergies": ["penicillin"]})
    assert p.phone == "+15551234567"
    assert p.medical_context["allergies"] == ["penicillin"]


def test_patient_create_minimal():
    p = PatientCreate(phone="+15551234567")
    assert p.name is None
    assert p.medical_context == {}


def test_appointment_create_requires_fields():
    with pytest.raises(ValidationError):
        AppointmentCreate(doctor_name="Dr. Smith")  # missing patient_id, scheduled_at


def test_appointment_create_valid():
    a = AppointmentCreate(
        patient_id=uuid.uuid4(),
        doctor_name="Dr. Smith",
        scheduled_at=datetime.now(timezone.utc),
        notes="Routine",
    )
    assert a.doctor_name == "Dr. Smith"
