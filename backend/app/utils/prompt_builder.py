"""Build enriched system prompts using Qdrant context."""
import uuid

from app.services.qdrant_svc import search_patient_memory


async def build_patient_context(patient_id: uuid.UUID | None, query: str = "patient history") -> str:
    """Return a formatted memory block for injection into system prompts."""
    if not patient_id:
        return ""
    memories = await search_patient_memory(patient_id, query, limit=5)
    if not memories:
        return ""
    lines = ["[Patient Memory from previous calls:]"]
    for m in memories:
        lines.append(f"- {m['text']}")
    return "\n".join(lines)
