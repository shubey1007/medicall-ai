"""Abstract base class for all medical sub-agents."""
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.services.call_manager import CallSession


RESPONSE_STYLE = """Response style:
- Keep replies under 2 sentences unless the patient explicitly asks for detail.
- Don't echo the patient's words back. Don't restate what was just said.
- Do not ask "Is there anything else?". Use the end_call tool when the patient is done.
- One question at a time. Never stack multiple questions in a single reply.
- Speak naturally and calmly. No filler phrases ("great question", "absolutely")."""

# For every non-triage role: the call is already under way when you activate.
# Do NOT greet, do NOT introduce yourself, do NOT ask the caller to repeat
# what they already said. Pick up the thread.
MID_CONVERSATION_RULE = """You are taking over mid-call from another role. The patient has already been greeted. Do NOT say hello, do NOT introduce a new agent, and do NOT re-ask information already collected in the transcript. Continue the conversation immediately with the next useful action (ask the next specific question or call a tool)."""


class BaseAgent(ABC):
    name: str
    description: str

    @abstractmethod
    def get_system_prompt(self) -> str:
        """Return the system prompt for this agent."""

    @abstractmethod
    def get_tools(self) -> list[dict[str, Any]]:
        """Return OpenAI-format tool definitions for the Realtime API."""

    @abstractmethod
    async def handle_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: "CallSession",
    ) -> dict[str, Any]:
        """Execute a tool call and return the structured result."""

    def should_route(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        result: dict[str, Any],
    ) -> str | None:
        """If the tool call indicates a handoff, return target agent name."""
        if tool_name == "route_to_agent":
            return arguments.get("agent_name")
        return None


ROUTE_TO_AGENT_TOOL = {
    "type": "function",
    "name": "route_to_agent",
    "description": "Transfer the call to another specialized agent.",
    "parameters": {
        "type": "object",
        "properties": {
            "agent_name": {
                "type": "string",
                "enum": ["triage", "scheduling", "medication", "emergency"],
                "description": "Target agent to transfer to.",
            },
            "reason": {
                "type": "string",
                "description": "Why this transfer is being made.",
            },
            "context": {
                "type": "object",
                "description": "Any context to pass to the next agent.",
            },
        },
        "required": ["agent_name", "reason"],
    },
}

END_CALL_TOOL: dict[str, Any] = {
    "type": "function",
    "name": "end_call",
    "description": (
        "End the phone call gracefully after confirming the patient has no further questions. "
        "Call this ONLY after asking 'Is there anything else I can help you with?' and "
        "the patient confirms they are done."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Brief reason for ending the call, e.g. 'Patient confirmed no further questions'",
            }
        },
        "required": ["reason"],
    },
}
