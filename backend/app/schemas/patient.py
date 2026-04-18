import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PatientBase(BaseModel):
    phone: str
    name: str | None = None
    medical_context: dict[str, Any] = Field(default_factory=dict)


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    phone: str | None = None
    name: str | None = None
    medical_context: dict[str, Any] | None = None


class PatientOut(PatientBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
