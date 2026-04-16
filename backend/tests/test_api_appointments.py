import pytest


@pytest.mark.asyncio
async def test_create_appointment(client):
    # Create a patient first
    patient = await client.post(
        "/api/patients",
        json={"phone": "+15550001111", "name": "Appt Patient", "medical_context": {}},
    )
    assert patient.status_code == 201
    patient_id = patient.json()["id"]

    response = await client.post(
        "/api/appointments",
        json={
            "patient_id": patient_id,
            "doctor_name": "Dr. Smith",
            "scheduled_at": "2026-06-01T10:00:00",
            "notes": "Annual checkup",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["doctor_name"] == "Dr. Smith"
    assert data["status"] == "pending"
    assert data["patient_id"] == patient_id


@pytest.mark.asyncio
async def test_list_appointments(client):
    patient = await client.post(
        "/api/patients",
        json={"phone": "+15550002222", "name": "List Patient"},
    )
    patient_id = patient.json()["id"]

    await client.post(
        "/api/appointments",
        json={"patient_id": patient_id, "doctor_name": "Dr. A", "scheduled_at": "2026-07-01T09:00:00"},
    )
    await client.post(
        "/api/appointments",
        json={"patient_id": patient_id, "doctor_name": "Dr. B", "scheduled_at": "2026-07-02T10:00:00"},
    )

    response = await client.get("/api/appointments", params={"patient_id": patient_id})
    assert response.status_code == 200
    assert response.json()["total"] == 2


@pytest.mark.asyncio
async def test_update_appointment(client):
    patient = await client.post(
        "/api/patients",
        json={"phone": "+15550003333", "name": "Update Patient"},
    )
    patient_id = patient.json()["id"]

    create = await client.post(
        "/api/appointments",
        json={"patient_id": patient_id, "doctor_name": "Dr. Old", "scheduled_at": "2026-08-01T11:00:00"},
    )
    appt_id = create.json()["id"]

    update = await client.put(
        f"/api/appointments/{appt_id}",
        json={"doctor_name": "Dr. New", "status": "confirmed"},
    )
    assert update.status_code == 200
    assert update.json()["doctor_name"] == "Dr. New"
    assert update.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_cancel_appointment(client):
    patient = await client.post(
        "/api/patients",
        json={"phone": "+15550004444", "name": "Cancel Patient"},
    )
    patient_id = patient.json()["id"]

    create = await client.post(
        "/api/appointments",
        json={"patient_id": patient_id, "doctor_name": "Dr. Cancel", "scheduled_at": "2026-09-01T14:00:00"},
    )
    appt_id = create.json()["id"]

    cancel = await client.delete(f"/api/appointments/{appt_id}")
    assert cancel.status_code == 204

    # Verify it's now CANCELLED (soft delete)
    list_resp = await client.get("/api/appointments", params={"patient_id": patient_id, "status": "cancelled"})
    assert list_resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_update_nonexistent_appointment_returns_404(client):
    response = await client.put(
        "/api/appointments/00000000-0000-0000-0000-000000000000",
        json={"doctor_name": "Dr. Ghost"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_cancel_nonexistent_appointment_returns_404(client):
    response = await client.delete("/api/appointments/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
