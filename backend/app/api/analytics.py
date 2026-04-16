from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Call, CallStatus, CallSummary, TranscriptEntry

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class UrgencyBreakdown(BaseModel):
    low: int = 0
    medium: int = 0
    high: int = 0
    critical: int = 0


class CallsPerDay(BaseModel):
    date: str
    count: int


class AnalyticsSummary(BaseModel):
    total_calls: int
    active_calls: int
    completed_calls: int
    average_duration_seconds: float
    urgency_breakdown: UrgencyBreakdown
    calls_per_day: list[CallsPerDay]


class AgentStats(BaseModel):
    agent_name: str
    message_count: int


class AgentAnalytics(BaseModel):
    agents: list[AgentStats]


@router.get("/summary", response_model=AnalyticsSummary)
async def analytics_summary(db: AsyncSession = Depends(get_db)) -> AnalyticsSummary:
    total = (await db.execute(select(func.count()).select_from(Call))).scalar_one()
    active = (
        await db.execute(
            select(func.count()).select_from(Call).where(Call.status == CallStatus.ACTIVE)
        )
    ).scalar_one()
    completed = (
        await db.execute(
            select(func.count()).select_from(Call).where(Call.status == CallStatus.COMPLETED)
        )
    ).scalar_one()
    avg_duration = (
        await db.execute(select(func.coalesce(func.avg(Call.duration_seconds), 0.0)))
    ).scalar_one()

    urgency_rows = await db.execute(
        select(CallSummary.urgency_level, func.count()).group_by(CallSummary.urgency_level)
    )
    breakdown = UrgencyBreakdown()
    for level, count in urgency_rows.all():
        setattr(breakdown, level.value, count)

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    daily_rows = await db.execute(
        select(
            func.date_trunc("day", Call.started_at).label("day"),
            func.count(),
        )
        .where(Call.started_at >= cutoff)
        .group_by("day")
        .order_by("day")
    )
    calls_per_day = [
        CallsPerDay(date=day.isoformat() if day else "", count=count)
        for day, count in daily_rows.all()
    ]

    return AnalyticsSummary(
        total_calls=total,
        active_calls=active,
        completed_calls=completed,
        average_duration_seconds=float(avg_duration or 0),
        urgency_breakdown=breakdown,
        calls_per_day=calls_per_day,
    )


@router.get("/agents", response_model=AgentAnalytics)
async def analytics_agents(db: AsyncSession = Depends(get_db)) -> AgentAnalytics:
    rows = await db.execute(
        select(TranscriptEntry.agent_name, func.count())
        .where(TranscriptEntry.agent_name.isnot(None))
        .group_by(TranscriptEntry.agent_name)
    )
    agents = [
        AgentStats(agent_name=name, message_count=count)
        for name, count in rows.all()
    ]
    return AgentAnalytics(agents=agents)
