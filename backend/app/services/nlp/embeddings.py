"""Sentence-Transformers embedding model (lazy singleton) + Redis cache."""
from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def _get_model():
    """Load the multilingual embedding model once and cache it."""
    from sentence_transformers import SentenceTransformer

    logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
    return SentenceTransformer(settings.EMBEDDING_MODEL)


def embed_text(text: str) -> list[float]:
    """Return a normalised embedding vector for a single text."""
    if not text or not text.strip():
        return [0.0] * settings.EMBEDDING_DIM
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return np.asarray(vec, dtype=float).tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts efficiently."""
    if not texts:
        return []
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [np.asarray(v, dtype=float).tolist() for v in vecs]


# --- Embedding cache (Redis DB2) --------------------------------------------
# Identical CV text re-uploaded/re-analysed reuses its embedding instead of
# re-running the (expensive) sentence-transformers model. Fail-open: any Redis
# problem silently falls back to recomputation.

_CACHE_PREFIX = "emb:cv:"


@lru_cache
def _cache_client():
    """Lazy Redis client for the embedding cache; ``None`` if unavailable."""
    if not settings.EMBEDDING_CACHE_ENABLED:
        return None
    try:
        import redis

        client = redis.Redis.from_url(
            settings.REDIS_CACHE_URL, socket_connect_timeout=1, socket_timeout=1
        )
        client.ping()
        return client
    except Exception as exc:  # pragma: no cover - Redis down or missing
        logger.warning("Embedding cache disabled (Redis unavailable): %s", exc)
        return None


def _normalize(text: str) -> str:
    """Collapse whitespace so trivially different copies share a cache entry."""
    return " ".join(text.split())


def _cache_key(normalized: str) -> str:
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{_CACHE_PREFIX}{digest}"


def embed_text_cached(text: str) -> list[float]:
    """Like :func:`embed_text` but backed by a SHA-256 Redis cache.

    On a hit the model call is skipped entirely. Any cache error (Redis down,
    malformed value, ...) falls back to recomputing the embedding.
    """
    if not text or not text.strip():
        return [0.0] * settings.EMBEDDING_DIM

    normalized = _normalize(text)
    key = _cache_key(normalized)
    client = _cache_client()

    if client is not None:
        try:
            cached = client.get(key)
            if cached is not None:
                vec = json.loads(cached)
                if isinstance(vec, list) and len(vec) == settings.EMBEDDING_DIM:
                    logger.debug("Embedding cache hit: %s", key)
                    return vec
        except Exception as exc:  # pragma: no cover - transient Redis error
            logger.warning("Embedding cache read failed (%s); recomputing", exc)

    vec = embed_text(normalized)

    if client is not None:
        try:
            client.setex(key, settings.EMBEDDING_CACHE_TTL_SECONDS, json.dumps(vec))
        except Exception as exc:  # pragma: no cover - transient Redis error
            logger.warning("Embedding cache write failed: %s", exc)

    return vec
