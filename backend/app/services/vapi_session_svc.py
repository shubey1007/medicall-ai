"""Build Vapi assistant configuration for each incoming call.

Vapi serverUrl mode: Vapi sends all events to our FastAPI server.
We respond with assistant config on 'assistant-request' events.
"""
from typing import Any

from app.agents.triage import TriageAgent
from app.config import get_settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def build_assistant_config(patient_name: str | None = None) -> dict[str, Any]:
    """Build dynamic Vapi assistant config for a new call."""
    agent = TriageAgent()
    system_prompt = agent.get_system_prompt()

    if patient_name:
        system_prompt = f"The patient's name is {patient_name}.\n\n{system_prompt}"

    settings = get_settings()
    server_url = settings.public_url

    return {
        "assistant": {
            "name": "MediCall AI",
            "model": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "systemPrompt": system_prompt,
                "temperature": 0.7,
                "tools": agent.get_tools(),
            },
            "voice": {
                "provider": "playht",
                "voiceId": "jennifer",
            },
            "transcriber": {
                "provider": "deepgram",
                "model": "nova-2",
                "language": "multi",
            },
            "firstMessage": "Hello! Welcome to MediCall AI. How can I help you today?",
            "serverUrl": f"{server_url}/api/vapi/tool-call",
            "endCallMessage": "Thank you for calling MediCall AI. Take care!",
            "backgroundSound": "off",
            "backchannelingEnabled": True,
        }
    }
