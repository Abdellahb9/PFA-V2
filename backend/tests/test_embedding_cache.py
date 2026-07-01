"""Unit tests for the Redis-backed embedding cache (no Redis, no model)."""
from __future__ import annotations

from app.core.config import settings
from app.services.nlp import embeddings


class FakeRedis:
    """Minimal in-memory stand-in for the redis client (get / setex)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str):
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value


def _counting_embedder(counter: dict):
    def _embed(text: str) -> list[float]:
        counter["n"] += 1
        return [0.1] * settings.EMBEDDING_DIM

    return _embed


def test_cache_miss_then_hit(monkeypatch):
    fake = FakeRedis()
    counter = {"n": 0}
    monkeypatch.setattr(embeddings, "_cache_client", lambda: fake)
    monkeypatch.setattr(embeddings, "embed_text", _counting_embedder(counter))

    text = "Ingénieur   Python\n\nNLP"

    v1 = embeddings.embed_text_cached(text)  # miss -> compute + store
    assert counter["n"] == 1
    assert len(v1) == settings.EMBEDDING_DIM
    assert len(fake.store) == 1

    v2 = embeddings.embed_text_cached(text)  # hit -> model NOT called again
    assert counter["n"] == 1
    assert v2 == v1


def test_cache_key_ignores_whitespace(monkeypatch):
    fake = FakeRedis()
    counter = {"n": 0}
    monkeypatch.setattr(embeddings, "_cache_client", lambda: fake)
    monkeypatch.setattr(embeddings, "embed_text", _counting_embedder(counter))

    embeddings.embed_text_cached("Ingénieur   Python\n\nNLP")
    # Same content, different whitespace -> normalised to the same key -> hit.
    embeddings.embed_text_cached("Ingénieur Python NLP")
    assert counter["n"] == 1
    assert len(fake.store) == 1


def test_fail_open_without_cache(monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(embeddings, "_cache_client", lambda: None)  # Redis down
    monkeypatch.setattr(embeddings, "embed_text", _counting_embedder(counter))

    embeddings.embed_text_cached("abc")
    embeddings.embed_text_cached("abc")
    assert counter["n"] == 2  # no cache -> recompute every time


def test_empty_text_short_circuits(monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(embeddings, "_cache_client", lambda: FakeRedis())
    monkeypatch.setattr(embeddings, "embed_text", _counting_embedder(counter))

    vec = embeddings.embed_text_cached("   ")
    assert vec == [0.0] * settings.EMBEDDING_DIM
    assert counter["n"] == 0  # never touches the model