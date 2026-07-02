"""Chunk of an ingested policy/process document, embedded for RAG retrieval."""

from __future__ import annotations

from pgvector.sqlalchemy import Vector
from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.core.database import Base
from app.models.mixins import TimestampMixin


class DocumentChunk(Base, TimestampMixin):
    """One retrievable chunk of a source document (internship policy, process...).

    Unlike ``Document`` (a candidate's uploaded CV attachment), rows here are
    knowledge-base content ingested by an admin and queried by the assistant.
    """

    __tablename__ = "document_chunks"
    __table_args__ = (
        # Re-ingesting a document replaces its chunks; indexes stay unique.
        UniqueConstraint("source_document", "chunk_index", name="uq_chunk_source_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Logical name of the source document (filename or admin-provided title).
    source_document: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Position of the chunk within the source document, starting at 0.
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.EMBEDDING_DIM), nullable=True
    )
    # Free-form context: page number, section title, language, ...
    meta: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
