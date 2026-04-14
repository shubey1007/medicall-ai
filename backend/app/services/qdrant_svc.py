"""Qdrant vector database service.

Three collections:
  patient_memory      — per-patient episodic memory (filtered by patient_id)
  medical_knowledge   — pre-seeded medical facts for RAG
  doctor_directory    — doctor profiles for semantic search
"""
import hashlib
import uuid
from typing import Any

from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.config import get_settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

EMBEDDING_DIM = 1536  # text-embedding-3-small

COLLECTIONS = {
    "patient_memory": VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
    "medical_knowledge": VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
    "doctor_directory": VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
}

_client: AsyncQdrantClient | None = None
_oai_client: AsyncOpenAI | None = None
_qdrant_available: bool = True


def get_client() -> AsyncQdrantClient:
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.qdrant_url:
            raise RuntimeError("QDRANT_URL is not configured")
        _client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
        )
    return _client


def get_oai_client() -> AsyncOpenAI:
    global _oai_client
    if _oai_client is None:
        settings = get_settings()
        _oai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _oai_client


async def close_client() -> None:
    """Close the Qdrant client connection. Called at app shutdown."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None


async def ensure_collections() -> None:
    """Create Qdrant collections if they don't exist. Called at app startup."""
    global _qdrant_available
    settings = get_settings()
    if not settings.qdrant_url or settings.qdrant_url == "":
        logger.warning("qdrant_not_configured", reason="QDRANT_URL not set")
        _qdrant_available = False
        return
    client = get_client()
    try:
        existing = {c.name for c in (await client.get_collections()).collections}
        for name, params in COLLECTIONS.items():
            if name not in existing:
                await client.create_collection(collection_name=name, vectors_config=params)
                logger.info("qdrant_collection_created", collection=name)
            else:
                logger.debug("qdrant_collection_exists", collection=name)
        _qdrant_available = True
        logger.info("qdrant_ready")
    except Exception as exc:
        logger.error("qdrant_ensure_collections_failed", error=str(exc))
        _qdrant_available = False


async def embed(text: str) -> list[float]:
    """Generate embedding using OpenAI text-embedding-3-small."""
    if not _qdrant_available:
        raise RuntimeError("Qdrant is not available; embedding is not supported in degraded mode")
    resp = await get_oai_client().embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return resp.data[0].embedding


async def upsert_patient_memory(
    patient_id: uuid.UUID,
    memory_text: str,
    metadata: dict[str, Any],
) -> None:
    """Store a patient memory chunk in Qdrant."""
    if not _qdrant_available:
        return
    vector = await embed(memory_text)
    stable_id = str(uuid.UUID(hashlib.md5(f"{patient_id}:{memory_text}".encode()).hexdigest()))
    point = PointStruct(
        id=stable_id,
        vector=vector,
        payload={
            "patient_id": str(patient_id),
            "text": memory_text,
            **metadata,
        },
    )
    await get_client().upsert(collection_name="patient_memory", points=[point])


async def search_patient_memory(
    patient_id: uuid.UUID,
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Semantic search over a patient's memories."""
    if not _qdrant_available:
        return []
    vector = await embed(query)
    results = await get_client().search(
        collection_name="patient_memory",
        query_vector=vector,
        query_filter=Filter(
            must=[FieldCondition(key="patient_id", match=MatchValue(value=str(patient_id)))]
        ),
        limit=limit,
        with_payload=True,
    )
    return [{"text": r.payload.get("text", ""), "score": r.score} for r in results if r.payload]


async def search_medical_knowledge(query: str, limit: int = 4) -> list[dict[str, Any]]:
    """RAG search over medical knowledge base."""
    if not _qdrant_available:
        return []
    vector = await embed(query)
    results = await get_client().search(
        collection_name="medical_knowledge",
        query_vector=vector,
        limit=limit,
        with_payload=True,
    )
    return [{"text": r.payload.get("text", ""), "score": r.score} for r in results if r.payload]


async def search_doctors(query: str, limit: int = 3) -> list[dict[str, Any]]:
    """Semantic doctor search (e.g. 'heart specialist available Monday')."""
    if not _qdrant_available:
        return []
    vector = await embed(query)
    results = await get_client().search(
        collection_name="doctor_directory",
        query_vector=vector,
        limit=limit,
        with_payload=True,
    )
    return [r.payload for r in results if r.payload]


async def upsert_doctor(doctor_id: uuid.UUID, profile_text: str, metadata: dict[str, Any]) -> None:
    """Sync a doctor record to Qdrant for semantic search."""
    if not _qdrant_available:
        return
    vector = await embed(profile_text)
    point = PointStruct(
        id=str(doctor_id),
        vector=vector,
        payload={"text": profile_text, "doctor_id": str(doctor_id), **metadata},
    )
    await get_client().upsert(collection_name="doctor_directory", points=[point])
