import pytest


@pytest.mark.asyncio
async def test_create_and_get_patient(client):
    response = await client.post(
        "/api/patients",
        json={"phone": "+15551112222", "name": "Test Patient", "medical_context": {}},
    )
    assert response.status_code == 201
    patient_id = response.json()["id"]

    get_response = await client.get(f"/api/patients/{patient_id}")
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Test Patient"


@pytest.mark.asyncio
async def test_duplicate_phone_rejected(client):
    await client.post("/api/patients", json={"phone": "+15559999999", "name": "A"})
    response = await client.post("/api/patients", json={"phone": "+15559999999", "name": "B"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_list_patients_with_search(client):
    await client.post("/api/patients", json={"phone": "+15551", "name": "Alice"})
    await client.post("/api/patients", json={"phone": "+15552", "name": "Bob"})
    response = await client.get("/api/patients", params={"search": "Alice"})
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Alice"


@pytest.mark.asyncio
async def test_update_patient(client):
    create = await client.post("/api/patients", json={"phone": "+15553", "name": "Original"})
    pid = create.json()["id"]
    update = await client.put(f"/api/patients/{pid}", json={"name": "Updated"})
    assert update.status_code == 200
    assert update.json()["name"] == "Updated"


@pytest.mark.asyncio
async def test_get_nonexistent_patient_returns_404(client):
    response = await client.get("/api/patients/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
