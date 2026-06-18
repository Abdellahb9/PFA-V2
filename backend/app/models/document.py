"""Uploaded document (CV, cover letter, transcript) stored in MinIO."""
from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.application import Application


class DocumentKind(str, enum.Enum):
    CV = "cv"
    COVER_LETTER = "cover_letter"
    TRANSCRIPT = "transcript"
    OTHER = "other"


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[DocumentKind] = mapped_column(
        Enum(DocumentKind, name="document_kind", values_callable=lambda e: [m.value for m in e]),
        default=DocumentKind.CV,
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Key of the object inside the MinIO/S3 bucket.
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Text extracted by the parsing pipeline (PyMuPDF / OCR fallback).
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    application: Mapped["Application"] = relationship(back_populates="documents")
