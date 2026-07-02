"""Internship offer (departmental need) and its required skills."""

from __future__ import annotations

import enum
from datetime import date
from typing import TYPE_CHECKING

from pgvector.sqlalchemy import Vector
from sqlalchemy import Date, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.department import Department
    from app.models.skill import Skill


class OfferStatus(enum.StrEnum):
    OPEN = "open"
    CLOSED = "closed"
    DRAFT = "draft"


class InternshipOffer(Base, TimestampMixin):
    """A staffing need published by a department (the 'job' side of matching)."""

    __tablename__ = "internship_offers"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    field: Mapped[str | None] = mapped_column(String(180), nullable=True)
    # Number of interns this specific offer can take.
    slots: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    min_education_level: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[OfferStatus] = mapped_column(
        Enum(OfferStatus, name="offer_status", values_callable=lambda e: [m.value for m in e]),
        default=OfferStatus.OPEN,
        nullable=False,
    )

    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.EMBEDDING_DIM), nullable=True
    )

    department: Mapped[Department] = relationship(back_populates="offers")
    required_skills: Mapped[list[OfferSkill]] = relationship(
        back_populates="offer", cascade="all, delete-orphan"
    )
    applications: Mapped[list[Application]] = relationship(back_populates="offer")


class OfferSkill(Base):
    """Association object: an offer requires a skill with an importance weight."""

    __tablename__ = "offer_skills"
    __table_args__ = (UniqueConstraint("offer_id", "skill_id", name="uq_offer_skill"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    offer_id: Mapped[int] = mapped_column(
        ForeignKey("internship_offers.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Importance of this skill for the offer, in [0, 1].
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    required: Mapped[bool] = mapped_column(default=False, nullable=False)

    offer: Mapped[InternshipOffer] = relationship(back_populates="required_skills")
    skill: Mapped[Skill] = relationship()

    @property
    def name(self) -> str:
        """Skill label, so this object validates directly into a SkillRef."""
        return self.skill.name
