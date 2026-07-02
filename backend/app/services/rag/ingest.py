"""Knowledge-base ingestion: chunk + embed policy documents into pgvector."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models.document_chunk import DocumentChunk
from app.services.nlp.embeddings import embed_batch
from app.services.nlp.parser import extract_text

logger = logging.getLogger(__name__)

# ~300-500 tokens per chunk with overlap works well for policy/process docs.
CHUNK_SIZE_CHARS = 1600
CHUNK_OVERLAP_CHARS = 200


def chunk_text(text: str) -> list[str]:
    """Split raw document text into overlapping retrieval-sized chunks."""
    from langchain.text_splitter import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE_CHARS,
        chunk_overlap=CHUNK_OVERLAP_CHARS,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return [c.strip() for c in splitter.split_text(text) if c.strip()]


def ingest_document(
    db: Session,
    source_document: str,
    data: bytes,
    filename: str,
    content_type: str | None = None,
    metadata: dict | None = None,
) -> int:
    """Extract, chunk and embed one document; returns the number of chunks stored.

    Re-ingesting a document with the same ``source_document`` name replaces its
    previous chunks so the knowledge base never holds stale duplicates.
    """
    text = extract_text(data, filename, content_type)
    if not text or not text.strip():
        logger.warning("No text extracted from %s; nothing ingested", filename)
        return 0

    chunks = chunk_text(text)
    embeddings = embed_batch(chunks)

    db.query(DocumentChunk).filter(DocumentChunk.source_document == source_document).delete()
    for index, (chunk, embedding) in enumerate(zip(chunks, embeddings, strict=False)):
        db.add(
            DocumentChunk(
                source_document=source_document,
                chunk_text=chunk,
                chunk_index=index,
                embedding=embedding,
                meta=metadata,
            )
        )
    db.commit()
    logger.info("Ingested %s: %d chunks", source_document, len(chunks))
    return len(chunks)
