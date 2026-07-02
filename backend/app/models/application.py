"""Internship application (demande de stage) submitted by a candidate."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.assignment import Assignment
    from app.models.candidate import Candidate
    from app.models.document import Document
    from app.models.offer import InternshipOffer


class ApplicationStatus(enum.StrEnum):
    """Lifecycle of an application from submission to final assignment."""

    SUBMITTED = "submitted"  # files received, awaiting parsing
    PARSING = "parsing"  # NLP pipeline running
    PARSED = "parsed"  # profile extracted, ready for matching
    UNDER_REVIEW = "under_review"  # a recruiter is reviewing
    ASSIGNED = "assigned"  # an assignment was confirmed
    REJECTED = "rejected"  # not retained
    FAILED = "failed"  # parsing error


class Application(Base, TimestampMixin):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Optional: a candidate may target a specific offer, or apply generally.
    offer_id: Mapped[int | None] = mapped_column(
        ForeignKey("internship_offers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(
            ApplicationStatus,
            name="application_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        default=ApplicationStatus.SUBMITTED,
        nullable=False,
        index=True,
    )
    motivation: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Best match score computed for this application, in [0, 1].
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    candidate: Mapped[Candidate] = relationship(back_populates="applications")
    offer: Mapped[InternshipOffer] = relationship(back_populates="applications")
    documents: Mapped[list[Document]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    assignment: Mapped[Assignment | None] = relationship(
        back_populates="application", uselist=False, cascade="all, delete-orphan"
    )
