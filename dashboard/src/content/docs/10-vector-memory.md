# Vector Memory (Qdrant)

How MediCall AI uses Qdrant for semantic search across three different domains.

## Why Vectors Instead of Keyword Search?

Medical language is messy. A patient might say "I've been feeling dizzy" and the relevant memory is "Patient reported lightheadedness during prior visit". A keyword search for "dizzy" returns nothing. A vector search returns it because both phrases embed to nearby points in 1536-dim space.

The same applies to medical knowledge ("chest pain" ≈ "MI symptoms" ≈ "tightness in chest") and doctor matching ("heart specialist" ≈ "cardiologist available Monday").

## Three Collections

| Collection | Vector Dim | Filter | Purpose |
|------------|-----------|--------|---------|
| `patient_memory` | 1536 | `patient_id` | Per-patient episodic memory: facts extracted from past calls |
| `medical_knowledge` | 1536 | none | Pre-seeded RAG chunks: drug info, conditions, emergency rubrics |
| `doctor_directory` | 1536 | none | Doctor profiles synced from Postgres for semantic discovery |

All three use the same embedding model (`text-embedding-3-small`) and cosine distance.

## Embedding Model Choice

`text-embedding-3-small`:
- **1536 dimensions** — small enough to be cheap, large enough to be accurate for short medical text
- **$0.02 per 1M tokens** — effectively free for our scale
- **Strong general performance** on the MTEB benchmark

We considered `text-embedding-3-large` (3072 dim, 6x cost) but found no meaningful accuracy improvement for short medical chunks (typically <100 tokens each).

## Patient Filtering

`search_patient_memory(patient_id, query, limit=5)` is the most security-sensitive call in the system — it must NEVER return memories from a different patient. We enforce this with a Qdrant `Filter`:

```python
results = await client.search(
    collection_name="patient_memory",
    query_vector=vector,
    query_filter=Filter(
        must=[FieldCondition(
            key="patient_id",
            match=MatchValue(value=str(patient_id)),
        )]
    ),
    limit=limit,
    with_payload=True,
)
```

Filters in Qdrant are evaluated *before* the vector search, so this is both fast and correct — there's no way for another patient's memories to leak into the result set even if the query is similar.

## Stable Point IDs (Idempotent Upserts)

If we ran the post-call memory pipeline twice on the same call, naive UUID generation would create duplicate points. We use a deterministic ID scheme:

```python
stable_id = str(uuid.UUID(
    hashlib.md5(f"{patient_id}:{memory_text}".encode()).hexdigest()
))
```

The same `(patient_id, memory_text)` pair always maps to the same UUID, so re-runs overwrite instead of accumulate. MD5 is fine here — we're using it as a content-addressable hash, not for security.

## Graceful Degradation

The entire app must work without Qdrant configured. The `qdrant_svc.py` module exposes a `_qdrant_available: bool = False` flag that's only flipped to `True` after `ensure_collections()` successfully connects:

```python
async def ensure_collections() -> None:
    global _qdrant_available
    settings = get_settings()
    if not settings.qdrant_url:
        logger.warning("qdrant_not_configured")
        _qdrant_available = False
        return
    try:
        client = get_client()
        existing = {c.name for c in (await client.get_collections()).collections}
        for name, params in COLLECTIONS.items():
            if name not in existing:
                await client.create_collection(name, vectors_config=params)
        _qdrant_available = True
        logger.info("qdrant_ready")
    except Exception as exc:
        logger.error("qdrant_ensure_collections_failed", error=str(exc))
        _qdrant_available = False
```

Every search/upsert function checks this flag and either returns `[]` (search) or no-ops (upsert). Only `embed()` raises a clear `RuntimeError` so callers fail fast on critical paths.

This means: a developer with no Qdrant credentials can clone the repo, run `docker compose up`, and the app starts cleanly. Memory features silently degrade — no crashes, no log spam.

## Lifecycle Management

The `AsyncQdrantClient` is a module-level singleton lazily instantiated in `get_client()`. On app shutdown the FastAPI lifespan calls `close_client()` which closes the underlying httpx connection pool and resets the singleton. This avoids resource leaks during rolling deploys.

## Seeding Medical Knowledge

`backend/scripts/seed_qdrant.py` reads `backend/data/medical_kb.json` (20 entries covering common medications, conditions, and emergency rubrics) and embeds + upserts each one into the `medical_knowledge` collection.

Run once after Qdrant is configured:

```bash
docker compose exec backend python scripts/seed_qdrant.py
```

The script guards against running without Qdrant configured by importing `qdrant_svc._qdrant_available` and exiting early with a clear error if False.

## Doctor Directory Sync

When a doctor is created or updated via `POST /api/doctors` or `PUT /api/doctors/{id}`, the route fires an `asyncio.create_task` that builds a profile string ("Dr. Patel is a Cardiology specialist. Available on monday, wednesday, friday from 09:00-17:00...") and upserts it into `doctor_directory`. Searching is then as simple as "I need a heart doctor for this Monday" → matching profiles.

## Tools That Use Qdrant

- **TriageAgent.recall_patient_memory** — searches `patient_memory` with the patient_id filter
- **MedicationAgent.search_medical_knowledge** — searches `medical_knowledge` for RAG-style answers
- **TriageAgent.find_doctor / SchedulingAgent.find_doctor** — searches `doctor_directory` for semantic matches
