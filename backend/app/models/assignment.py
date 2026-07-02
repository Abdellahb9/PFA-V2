"""Assignment (affectation) of a candidate to an internship offer."""

from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.application import Application
    from app.models.candidate import Candidate
    from app.models.matching_run import MatchingRun
    from app.models.offer import InternshipOffer


class AssignmentStatus(enum.StrEnum):
    PROPOSED = "proposed"  # produced by the optimiser, awaiting validation
    CONFIRMED = "confirmed"  # validated by a recruiter/admin
    REJECTED = "rejected"  # discarded


class Assignment(Base, TimestampMixin):
    __tablename__ = "assignments"
    __table_args__ = (
        # One active assignment per application.
        UniqueConstraint("application_id", name="uq_assignment_application"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offer_id: Mapped[int] = mapped_column(
        ForeignKey("internship_offers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    matching_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("matching_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Final composite match score for this pairing, in [0, 1].
    match_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # Breakdown of the score (semantic / skills / education) for explainability.
    score_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(
            AssignmentStatus,
            name="assignment_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        default=AssignmentStatus.PROPOSED,
        nullable=False,
    )
    decided_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    application: Mapped[Application] = relationship(back_populates="assignment")
    candidate: Mapped[Candidate] = relationship()
    offer: Mapped[InternshipOffer] = relationship()
    matching_run: Mapped[MatchingRun | None] = relationship(back_populates="assignments")
