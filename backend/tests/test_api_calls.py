import pytest


@pytest.mark.asyncio
async def test_list_calls_empty(client):
    response = await client.get("/api/calls")
    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_get_nonexistent_call_returns_404(client):
    response = await client.get("/api/calls/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_calls_pagination_params(client):
    response = await client.get("/api/calls", params={"page": 1, "page_size": 10})
    assert response.status_code == 200
    assert response.json()["page"] == 1
    assert response.json()["page_size"] == 10
