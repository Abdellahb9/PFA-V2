"""Shared FastAPI dependencies: DB session, current user, RBAC guards."""
from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve and validate the authenticated user from the bearer token."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Identifiants invalides",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise credentials_exc
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
    return user


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """Dependency factory enforcing that the user has one of ``roles``."""

    def _guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permissions insuffisantes",
            )
        return current_user

    return _guard


# Convenience guards.
require_admin = require_roles(UserRole.ADMIN)
require_staff = require_roles(UserRole.ADMIN, UserRole.RECRUITER)
