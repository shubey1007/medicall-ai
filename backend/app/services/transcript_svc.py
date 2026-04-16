"""Async batch-insert service for transcript entries.

Decouples the audio hot-path from DB writes via an asyncio.Queue.
A background consumer accumulates up to 10 entries or 2 seconds, whichever
comes first, and bulk-inserts them to reduce DB round trips.
"""
import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.database import db_session
from app.models import TranscriptEntry, TranscriptRole
from app.utils.logger import get_logger

logger = get_logger(__name__)

BATCH_SIZE = 10
FLUSH_INTERVAL_SECONDS = 2.0


@dataclass
class PendingEntry:
    call_id: uuid.UUID
    role: TranscriptRole
    content: str
    agent_name: str | None
    timestamp: datetime


class TranscriptService:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[PendingEntry] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()

    async def enqueue(
        self,
        call_id: uuid.UUID,
        role: TranscriptRole,
        content: str,
        agent_name: str | None = None,
    ) -> None:
        await self._queue.put(PendingEntry(
            call_id=call_id,
            role=role,
            content=content,
            agent_name=agent_name,
            timestamp=datetime.now(timezone.utc),
        ))

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopped.clear()
            self._task = asyncio.create_task(self._consumer_loop())
            logger.info("transcript_service_started")

    async def stop(self) -> None:
        self._stopped.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except asyncio.TimeoutError:
                self._task.cancel()
        logger.info("transcript_service_stopped")

    async def _consumer_loop(self) -> None:
        while not self._stopped.is_set():
            batch: list[PendingEntry] = []
            loop = asyncio.get_running_loop()
            deadline = loop.time() + FLUSH_INTERVAL_SECONDS

            while len(batch) < BATCH_SIZE:
                timeout = deadline - loop.time()
                if timeout <= 0:
                    break
                try:
                    entry = await asyncio.wait_for(self._queue.get(), timeout=timeout)
                    batch.append(entry)
                except asyncio.TimeoutError:
                    break

            if batch:
                await self._flush(batch)

        # Drain remaining entries on stop
        remaining: list[PendingEntry] = []
        while not self._queue.empty():
            try:
                remaining.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        if remaining:
            await self._flush(remaining)

    async def _flush(self, batch: list[PendingEntry]) -> None:
        try:
            async with db_session() as db:
                db.add_all([
                    TranscriptEntry(
                        call_id=e.call_id,
                        role=e.role,
                        content=e.content,
                        agent_name=e.agent_name,
                        timestamp=e.timestamp,
                    )
                    for e in batch
                ])
                await db.commit()
            logger.debug("transcript_flushed", count=len(batch))
        except Exception as exc:
            logger.exception("transcript_flush_failed", error=str(exc), count=len(batch))


transcript_service = TranscriptService()
