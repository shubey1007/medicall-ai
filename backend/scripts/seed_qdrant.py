"""One-time script to seed the medical_knowledge Qdrant collection.

Usage (from inside the backend container):
    python scripts/seed_qdrant.py

Or from host:
    docker compose exec backend python scripts/seed_qdrant.py
"""
import asyncio
import json
import os
import sys
import uuid

# Allow imports from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.qdrant_svc import embed, ensure_collections, get_client
from qdrant_client.models import PointStruct


async def seed_medical_knowledge() -> None:
    kb_path = os.path.join(os.path.dirname(__file__), "..", "data", "medical_kb.json")
    with open(kb_path, encoding="utf-8") as f:
        entries = json.load(f)

    await ensure_collections()
    client = get_client()

    points = []
    for entry in entries:
        vector = await embed(entry["text"])
        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "text": entry["text"],
                "category": entry.get("category", "general"),
                "tags": entry.get("tags", []),
                "source_id": entry["id"],
            },
        ))
        print(f"  Embedded: {entry['id']}")

    await client.upsert(collection_name="medical_knowledge", points=points)
    print(f"\nSeeded {len(points)} entries into medical_knowledge.")


if __name__ == "__main__":
    asyncio.run(seed_medical_knowledge())
