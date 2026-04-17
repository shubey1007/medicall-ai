"""Post-call memory consolidation.

After a call ends and the summary is saved, extract key medical facts
from the transcript and store them in Qdrant patient_memory collection.
"""
import json
import uuid

from openai import AsyncOpenAI

from app.services.qdrant_svc import upsert_patient_memory
from app.services.settings_svc import get_effective
from app.utils.logger import get_logger

logger = get_logger(__name__)

EXTRACTION_PROMPT = """You are a medical records assistant. Extract key facts from this call transcript that are worth remembering for future calls with this patient.

Focus on:
- Symptoms mentioned (with severity if stated)
- Medications mentioned or asked about
- Medical conditions discussed
- Appointments booked or cancelled
- Patient preferences or concerns

Return a JSON object with a single key "memories" containing an array of objects. Each object has:
  "text": "one-sentence fact about the patient"
  "type": one of: symptom | medication | condition | appointment | preference

Return ONLY valid JSON, no other text. Maximum 5 items.

Example:
{"memories": [
  {"text": "Patient reported chest pain rated 7/10 severity", "type": "symptom"},
  {"text": "Patient takes ibuprofen for chronic back pain", "type": "medication"}
]}

Transcript:
{transcript}"""


async def consolidate(
    patient_id: uuid.UUID | None,
    call_id: uuid.UUID | None,
    transcript_text: str,
) -> None:
    """Extract memories from transcript and store in Qdrant.

    If patient_id is None (e.g., Vapi demo path with no DB patient),
    the extraction step is skipped and no memories are stored.
    """
    if not transcript_text.strip():
        return

    if not patient_id:
        logger.debug("memory_consolidation_skipped", reason="no_patient_id")
        return

    if not get_effective("qdrant_url"):
        logger.debug("memory_consolidation_skipped", reason="qdrant_not_configured")
        return

    try:
        client = AsyncOpenAI(api_key=get_effective("openai_api_key"))
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": EXTRACTION_PROMPT.format(transcript=transcript_text[:4000]),
                }
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )

        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        memories: list = data.get("memories", [])

        for mem in memories[:5]:
            text = mem.get("text", "").strip()
            if text:
                await upsert_patient_memory(
                    patient_id=patient_id,
                    memory_text=text,
                    metadata={
                        "type": mem.get("type", "general"),
                        "call_id": str(call_id),
                    },
                )

        logger.info(
            "memory_consolidated",
            patient_id=str(patient_id),
            call_id=str(call_id),
            count=len(memories),
        )
    except Exception as exc:
        logger.exception("memory_consolidation_failed", error=str(exc))
