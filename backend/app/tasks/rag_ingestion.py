"""Celery task: ingest a knowledge-base document (chunk + embed) into pgvector."""

from __future__ import annotations

import logging

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services.rag.ingest import ingest_document
from app.services.storage import download_document

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.rag_ingestion.ingest_kb_document", bind=True, max_retries=2)
def ingest_kb_document(
    self,
    object_key: str,
    source_document: str,
    filename: str,
    content_type: str | None = None,
    metadata: dict | None = None,
) -> dict:
    """Download a stored document and ingest it into the RAG knowledge base.

    Runs async because chunking + embedding a large PDF can exceed request
    timeouts — same pattern as ``analyze_application``.
    """
    db = SessionLocal()
    try:
        data = download_document(object_key)
        count = ingest_document(
            db,
            source_document=source_document,
            data=data,
            filename=filename,
            content_type=content_type,
            metadata=metadata,
        )
        return {"status": "ingested", "source_document": source_document, "chunks": count}
    except Exception as exc:  # pragma: no cover - retry on transient errors
        db.rollback()
        logger.exception("KB ingestion failed for %s", source_document)
        raise self.retry(exc=exc, countdown=10) from exc
    finally:
        db.close()
