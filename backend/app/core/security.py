"""Password hashing and JWT helpers (OAuth2 + JWT)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# bcrypt operates on the first 72 bytes only; we truncate explicitly so that
# longer inputs hash/verify deterministically instead of raising (bcrypt>=4.1).
_BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    """Return a bcrypt hash for the given plaintext password."""
    pw = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plaintext password against its stored bcrypt hash."""
    try:
        pw = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _create_token(subject: str, expires_delta: timedelta, token_type: str,
                  extra: dict[str, Any] | None = None) -> str:
    """Build and sign a JWT with standard + custom claims."""
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + expires_delta,
        "type": token_type,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str, role: str) -> str:
    """Short-lived access token carrying the user role."""
    return _create_token(
        subject,
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "access",
        {"role": role},
    )


def create_refresh_token(subject: str) -> str:
    """Long-lived refresh token used to mint new access tokens."""
    return _create_token(
        subject,
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        "refresh",
    )


def decode_token(token: str) -> dict[str, Any] | None:
    """Decode/verify a JWT, returning its claims or None if invalid."""
    try:
        return jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None
