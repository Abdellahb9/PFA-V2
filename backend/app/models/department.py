"""Internal department / service that hosts interns."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.offer import InternshipOffer


class Department(Base, TimestampMixin):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    supervisor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    supervisor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Total simultaneous interns the department can supervise.
    capacity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    offers: Mapped[list[InternshipOffer]] = relationship(
        back_populates="department", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Department {self.code}>"
