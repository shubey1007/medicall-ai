import pytest


@pytest.mark.asyncio
async def test_analytics_summary_empty_db(client):
    response = await client.get("/api/analytics/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["total_calls"] == 0
    assert data["active_calls"] == 0
    assert data["urgency_breakdown"]["low"] == 0


@pytest.mark.asyncio
async def test_analytics_agents_empty(client):
    response = await client.get("/api/analytics/agents")
    assert response.status_code == 200
    assert response.json()["agents"] == []
