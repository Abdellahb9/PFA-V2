"""Record of a global matching/optimisation run (Hungarian algorithm)."""
from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, Float, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.assignment import Assignment


class MatchingRunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class MatchingRun(Base, TimestampMixin):
    __tablename__ = "matching_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    algorithm: Mapped[str] = mapped_column(String(60), default="hungarian", nullable=False)
    status: Mapped[MatchingRunStatus] = mapped_column(
        Enum(MatchingRunStatus, name="matching_run_status",
             values_callable=lambda e: [m.value for m in e]),
        default=MatchingRunStatus.PENDING,
        nullable=False,
    )
    total_candidates: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_slots: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assignments_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    average_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # Free-form weights/params used for the run (semantic vs skill vs education).
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    assignments: Mapped[list["Assignment"]] = relationship(back_populates="matching_run")
