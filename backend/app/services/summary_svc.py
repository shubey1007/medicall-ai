"""Generate AI post-call summaries using OpenAI Chat Completions."""
import asyncio
import json
import uuid
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import db_session
from app.models import Call, CallSummary, UrgencyLevel
from app.services import memory_svc
from app.utils.logger import get_logger

logger = get_logger(__name__)


SUMMARY_SYSTEM_PROMPT = """You are a medical call analyst. Given a transcript of a phone call
between a patient and an AI medical assistant, produce a structured JSON summary.

Return ONLY valid JSON matching this schema:
{
  "summary_text": "2-3 sentence narrative of what happened",
  "extracted_symptoms": ["symptom1", "symptom2"],
  "urgency_level": "low" | "medium" | "high" | "critical",
  "recommended_actions": ["action1", "action2"]
}

Urgency rubric:
- critical: life-threatening (chest pain, stroke, severe bleeding)
- high: needs same-day attention (high fever, severe pain)
- medium: needs follow-up within days
- low: routine or informational"""


async def generate_summary(call_id: uuid.UUID) -> CallSummary | None:
    """Fetch transcript, call OpenAI, save CallSummary to DB."""
    settings = get_settings()

    async with db_session() as db:
        result = await db.execute(
            select(Call)
            .where(Call.id == call_id)
            .options(selectinload(Call.transcript_entries))
        )
        call = result.scalar_one_or_none()
        if call is None:
            logger.error("summary_call_not_found", call_id=str(call_id))
            return None

        if not call.transcript_entries:
            logger.warning("summary_empty_transcript", call_id=str(call_id))
            return None

        transcript = "\n".join(
            f"[{e.role.value}{':'+e.agent_name if e.agent_name else ''}] {e.content}"
            for e in call.transcript_entries
        )
        # Capture patient_id while session is still open (avoids DetachedInstanceError)
        patient_id = call.patient_id

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    try:
        response = await client.chat.completions.create(
            model=settings.post_call_summary_model,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": f"Transcript:\n{transcript}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        raw = response.choices[0].message.content or "{}"
        data: dict[str, Any] = json.loads(raw)
    except Exception as exc:
        logger.exception("summary_generation_failed", error=str(exc), call_id=str(call_id))
        return None

    try:
        urgency = UrgencyLevel(data.get("urgency_level", "low"))
    except ValueError:
        urgency = UrgencyLevel.LOW

    async with db_session() as db:
        summary = CallSummary(
            call_id=call_id,
            summary_text=data.get("summary_text", ""),
            extracted_symptoms=data.get("extracted_symptoms", []),
            urgency_level=urgency,
            recommended_actions=data.get("recommended_actions", []),
        )
        db.add(summary)
        await db.flush()
        await db.commit()
        logger.info(
            "summary_generated",
            call_id=str(call_id),
            urgency=urgency.value,
            symptom_count=len(summary.extracted_symptoms),
        )

        # Trigger post-call memory consolidation in background
        asyncio.create_task(
            _consolidate_memory(
                patient_id=patient_id,
                call_id=call_id,
            )
        )

        return summary


async def _consolidate_memory(
    patient_id: uuid.UUID,
    call_id: uuid.UUID,
) -> None:
    """Background task: extract and store memories from call transcript."""
    from app.models import TranscriptEntry
    try:
        async with db_session() as db:
            result = await db.execute(
                select(TranscriptEntry)
                .where(TranscriptEntry.call_id == call_id)
                .order_by(TranscriptEntry.timestamp)
            )
            rows = result.scalars().all()
            transcript_text = "\n".join(
                f"{row.role.value}: {row.content}" for row in rows
            )
        await memory_svc.consolidate(
            patient_id=patient_id,
            call_id=call_id,
            transcript_text=transcript_text,
        )
    except Exception as exc:
        logger.exception("memory_consolidation_task_failed", error=str(exc))
