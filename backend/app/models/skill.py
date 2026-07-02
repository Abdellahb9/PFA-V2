"""Skill taxonomy shared by candidates and internship offers."""

from __future__ import annotations

import enum

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class SkillCategory(enum.StrEnum):
    """High-level grouping used for filtering and weighting."""

    TECHNICAL = "technical"
    SOFT = "soft"
    LANGUAGE = "language"
    DOMAIN = "domain"


class Skill(Base, TimestampMixin):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True)
    # `name` is the human label; `normalized` is lower-cased/deduplicated.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    category: Mapped[SkillCategory] = mapped_column(
        Enum(SkillCategory, name="skill_category", values_callable=lambda e: [m.value for m in e]),
        default=SkillCategory.TECHNICAL,
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Skill {self.normalized}>"
