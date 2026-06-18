"""Application user (admin / recruiter / viewer)."""
from __future__ import annotations

import enum

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class UserRole(str, enum.Enum):
    """Authorization roles used by the RBAC dependencies."""

    ADMIN = "admin"          # full access, manages matching runs and users
    RECRUITER = "recruiter"  # reviews applications, confirms assignments
    VIEWER = "viewer"        # read-only dashboards


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=lambda e: [m.value for m in e]),
        default=UserRole.RECRUITER,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email} ({self.role})>"
