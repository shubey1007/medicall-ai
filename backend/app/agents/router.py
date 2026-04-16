"""Agent registry and state machine for MediCall AI."""
from app.agents.base import BaseAgent
from app.agents.emergency import EmergencyAgent
from app.agents.medication import MedicationAgent
from app.agents.scheduling import SchedulingAgent
from app.agents.triage import TriageAgent


class AgentRouter:
    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {
            "triage": TriageAgent(),
            "scheduling": SchedulingAgent(),
            "medication": MedicationAgent(),
            "emergency": EmergencyAgent(),
        }

    def get_initial(self) -> BaseAgent:
        return self._agents["triage"]

    def get(self, name: str) -> BaseAgent:
        if name not in self._agents:
            raise KeyError(f"Unknown agent: {name}")
        return self._agents[name]

    def all_names(self) -> list[str]:
        return list(self._agents.keys())


agent_router = AgentRouter()
