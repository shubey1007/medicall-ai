"""Runtime settings store that overlays DB values on top of .env defaults.

Usage:
    from app.services.settings_svc import get_effective

    url = get_effective("qdrant_url")          # DB first, then .env
    key = get_effective("openai_api_key")

Call `await load_from_db(session)` once at startup to populate the cache.
Call `refresh(new_values)` after a PUT /api/settings to update in-memory.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

# In-memory overlay: key → value loaded from app_settings table.
# Only non-empty DB values override .env.
_db_override: dict[str, str] = {}


async def load_from_db(session: AsyncSession) -> None:
    """Load all app_settings rows into the in-memory cache."""
    from app.models.app_setting import AppSetting  # avoid circular import

    result = await session.execute(select(AppSetting))
    rows = result.scalars().all()
    for row in rows:
        if row.value:
            _db_override[row.key] = row.value


def refresh(new_values: dict[str, str]) -> None:
    """Update in-memory cache after a settings save (call from PUT handler).

    Also invalidates cached client singletons (e.g. Qdrant, OpenAI embedding
    client) so the next call rebuilds them against the new credentials. If
    Qdrant-related keys changed, asynchronously re-runs ensure_collections()
    so the `_qdrant_available` flag flips on without requiring a restart.
    """
    for k, v in new_values.items():
        if v:
            _db_override[k] = v
        else:
            _db_override.pop(k, None)

    # Invalidate singletons whose creds may have changed.
    # Late import to avoid circular dependency (qdrant_svc imports this module).
    try:
        from app.services import qdrant_svc

        qdrant_svc._client = None
        qdrant_svc._oai_client = None

        # If Qdrant credentials were touched, retry initialisation so the
        # availability flag flips on (previously stuck at startup value).
        if any(k in new_values for k in ("qdrant_url", "qdrant_api_key", "openai_api_key")):
            import asyncio

            try:
                loop = asyncio.get_running_loop()
                loop.create_task(qdrant_svc.ensure_collections())
            except RuntimeError:
                # No running event loop — skip (e.g. during tests)
                pass
    except Exception:
        pass


def get_effective(key: str) -> str:
    """Return DB-stored value if set, otherwise fall back to .env setting."""
    if key in _db_override and _db_override[key]:
        return _db_override[key]
    settings = get_settings()
    return getattr(settings, key, "") or ""
