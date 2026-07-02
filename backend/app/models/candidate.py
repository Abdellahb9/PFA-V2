"""Candidate (student) profile and skill associations."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pgvector.sqlalchemy import Vector
from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.skill import Skill


class Candidate(Base, TimestampMixin):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Education metadata extracted from the CV / submitted form.
    education_level: Mapped[str | None] = mapped_column(String(120), nullable=True)
    field_of_study: Mapped[str | None] = mapped_column(String(180), nullable=True)
    university: Mapped[str | None] = mapped_column(String(200), nullable=True)
    years_experience: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Raw concatenated CV text (post-OCR / PDF extraction).
    cv_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Dense semantic embedding of the profile (pgvector).
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.EMBEDDING_DIM), nullable=True
    )

    skills: Mapped[list[CandidateSkill]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    applications: Mapped[list[Application]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class CandidateSkill(Base):
    """Association object: a candidate possesses a skill with a given weight."""

    __tablename__ = "candidate_skills"
    __table_args__ = (UniqueConstraint("candidate_id", "skill_id", name="uq_candidate_skill"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Confidence / proficiency in [0, 1], inferred by the NLP pipeline.
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)

    candidate: Mapped[Candidate] = relationship(back_populates="skills")
    skill: Mapped[Skill] = relationship()

    @property
    def name(self) -> str:
        """Skill label, so this object validates directly into a SkillRef."""
        return self.skill.name
