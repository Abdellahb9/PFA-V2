"""Sentence-Transformers embedding model (lazy singleton)."""
from __future__ import annotations

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
