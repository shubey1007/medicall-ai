import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.call import CallStatus
from app.models.summary import UrgencyLevel
from app.models.transcript import TranscriptRole


class TranscriptEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: TranscriptRole
    content: str
    agent_name: str | None
    timestamp: datetime


class CallSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    summary_text: str
    extracted_symptoms: list[str]
    urgency_level: UrgencyLevel
    recommended_actions: list[str]
    created_at: datetime


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    call_sid: str
    patient_id: uuid.UUID
    status: CallStatus
    current_agent: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    patient_name: str | None = None
    urgency_level: str | None = None


class CallDetailOut(CallOut):
    transcript_entries: list[TranscriptEntryOut] = []
    summary: CallSummaryOut | None = None
