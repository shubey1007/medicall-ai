import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DoctorCreate(BaseModel):
    name: str
    specialization: str
    phone: str | None = None
    email: str | None = None
    available_days: list[str] = []
    available_hours: str = "09:00-17:00"
    bio: str | None = None
    is_active: bool = True


class DoctorUpdate(BaseModel):
    name: str | None = None
    specialization: str | None = None
    phone: str | None = None
    email: str | None = None
    available_days: list[str] | None = None
    available_hours: str | None = None
    bio: str | None = None
    is_active: bool | None = None


class DoctorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    specialization: str
    phone: str | None
    email: str | None
    available_days: list[str]
    available_hours: str
    bio: str | None
    is_active: bool
    created_at: datetime
