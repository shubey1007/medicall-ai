import pytest
from app.agents.router import AgentRouter
from app.agents.triage import TriageAgent
from app.agents.scheduling import SchedulingAgent
from app.agents.medication import MedicationAgent
from app.agents.emergency import EmergencyAgent


def test_router_returns_initial_triage():
    router = AgentRouter()
    assert router.get_initial().name == "triage"


def test_router_get_by_name():
    router = AgentRouter()
    assert isinstance(router.get("triage"), TriageAgent)
    assert isinstance(router.get("scheduling"), SchedulingAgent)
    assert isinstance(router.get("medication"), MedicationAgent)
    assert isinstance(router.get("emergency"), EmergencyAgent)


def test_router_get_unknown_raises():
    router = AgentRouter()
    with pytest.raises(KeyError):
        router.get("nonexistent")
