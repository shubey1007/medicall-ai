"""Qdrant vector database service.

Three collections:
  patient_memory      — per-patient episodic memory (filtered by patient_id)
  medical_knowledge   — pre-seeded medical facts for RAG
  doctor_directory    — doctor profiles for semantic search
"""
import uuid
from typing import Any

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


def get_client() -> AsyncQdrantClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
        )
    return _client


async def ensure_collections() -> None:
    """Create Qdrant collections if they don't exist. Called at app startup."""
    client = get_client()
    try:
        existing = {c.name for c in (await client.get_collections()).collections}
        for name, params in COLLECTIONS.items():
            if name not in existing:
                await client.create_collection(collection_name=name, vectors_config=params)
                logger.info("qdrant_collection_created", collection=name)
            else:
                logger.debug("qdrant_collection_exists", collection=name)
    except Exception as exc:
        logger.warning("qdrant_ensure_collections_failed", error=str(exc))


async def embed(text: str) -> list[float]:
    """Generate embedding using OpenAI text-embedding-3-small."""
    from openai import AsyncOpenAI
    settings = get_settings()
    client_oai = AsyncOpenAI(api_key=settings.openai_api_key)
    resp = await client_oai.embeddings.create(
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
    vector = await embed(memory_text)
    point = PointStruct(
        id=str(uuid.uuid4()),
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
    return [{"text": r.payload["text"], "score": r.score} for r in results]


async def search_medical_knowledge(query: str, limit: int = 4) -> list[dict[str, Any]]:
    """RAG search over medical knowledge base."""
    vector = await embed(query)
    results = await get_client().search(
        collection_name="medical_knowledge",
        query_vector=vector,
        limit=limit,
        with_payload=True,
    )
    return [{"text": r.payload["text"], "score": r.score} for r in results]


async def search_doctors(query: str, limit: int = 3) -> list[dict[str, Any]]:
    """Semantic doctor search (e.g. 'heart specialist available Monday')."""
    vector = await embed(query)
    results = await get_client().search(
        collection_name="doctor_directory",
        query_vector=vector,
        limit=limit,
        with_payload=True,
    )
    return [r.payload for r in results]


async def upsert_doctor(doctor_id: uuid.UUID, profile_text: str, metadata: dict[str, Any]) -> None:
    """Sync a doctor record to Qdrant for semantic search."""
    vector = await embed(profile_text)
    point = PointStruct(
        id=str(doctor_id),
        vector=vector,
        payload={"text": profile_text, "doctor_id": str(doctor_id), **metadata},
    )
    await get_client().upsert(collection_name="doctor_directory", points=[point])
