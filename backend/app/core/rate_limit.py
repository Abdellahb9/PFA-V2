"""Lightweight Redis-backed rate limiter for public endpoints.

Counts requests per client IP in a sliding fixed window. Authenticated staff
(valid bearer token) bypass the limit. Fails open if Redis is unavailable so a
cache outage never blocks legitimate users.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from functools import lru_cache

import redis
from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.core.security import decode_token

logger = logging.getLogger(__name__)


@lru_cache
def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _client_ip(request: Request) -> str:
    # Honour the proxy header (nginx) when present, else the socket peer.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _is_authenticated(request: Request) -> bool:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        payload = decode_token(auth.split(" ", 1)[1])
        return bool(payload and payload.get("type") == "access")
    return False


def rate_limit(prefix: str, limit: int, window_seconds: int) -> Callable[[Request], None]:
    """Return a FastAPI dependency enforcing ``limit`` requests / ``window``."""

    def dependency(request: Request) -> None:
        if _is_authenticated(request):
            return  # staff are not rate-limited
        ip = _client_ip(request)
        key = f"ratelimit:{prefix}:{ip}"
        try:
            client = _client()
            count = client.incr(key)
            if count == 1:
                client.expire(key, window_seconds)
            if count > limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Trop de candidatures envoyées depuis cette adresse. "
                    "Veuillez réessayer plus tard.",
                )
        except redis.RedisError as exc:  # pragma: no cover - fail open
            logger.warning("Rate limiter unavailable, allowing request: %s", exc)

    return dependency
