import pytest
from unittest.mock import MagicMock
from app.agents.medication import MedicationAgent


@pytest.fixture
def agent():
    return MedicationAgent()


@pytest.mark.asyncio
async def test_known_medication_lookup(agent):
    result = await agent.handle_tool_call(
        "lookup_medication_info",
        {"medication_name": "Ibuprofen"},
        MagicMock(),
    )
    assert result["found"] is True
    assert result["medication"] == "ibuprofen"
    assert "NSAID" in result["category"]


@pytest.mark.asyncio
async def test_unknown_medication_returns_not_found(agent):
    result = await agent.handle_tool_call(
        "lookup_medication_info",
        {"medication_name": "ZzzFakeDrug"},
        MagicMock(),
    )
    assert result["found"] is False
    assert "pharmacist" in result["message"].lower()
