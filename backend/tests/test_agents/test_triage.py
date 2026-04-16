import pytest
from unittest.mock import MagicMock
from app.agents.triage import TriageAgent


@pytest.fixture
def agent():
    return TriageAgent()


@pytest.fixture
def mock_session():
    s = MagicMock()
    s.patient_phone = "+15551234567"
    return s


@pytest.mark.asyncio
async def test_urgency_critical_for_chest_pain(agent, mock_session):
    result = await agent.handle_tool_call(
        "assess_urgency",
        {"symptoms": ["chest pain", "sweating"], "severity": 8},
        mock_session,
    )
    assert result["urgency_level"] == "critical"


@pytest.mark.asyncio
async def test_urgency_high_for_severity_9(agent, mock_session):
    result = await agent.handle_tool_call(
        "assess_urgency",
        {"symptoms": ["headache"], "severity": 9},
        mock_session,
    )
    assert result["urgency_level"] == "critical"


@pytest.mark.asyncio
async def test_urgency_low_for_mild_symptoms(agent, mock_session):
    result = await agent.handle_tool_call(
        "assess_urgency",
        {"symptoms": ["runny nose"], "severity": 2},
        mock_session,
    )
    assert result["urgency_level"] == "low"


def test_route_detection(agent):
    target = agent.should_route(
        "route_to_agent",
        {"agent_name": "emergency", "reason": "critical"},
        {},
    )
    assert target == "emergency"


def test_route_returns_none_for_non_route_tool(agent):
    target = agent.should_route("assess_urgency", {}, {})
    assert target is None


def test_tools_include_route_function(agent):
    names = [t["name"] for t in agent.get_tools()]
    assert "route_to_agent" in names
    assert "assess_urgency" in names
    assert "lookup_patient" in names
