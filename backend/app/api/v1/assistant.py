"""RAG assistant endpoints: unified query + knowledge-base document management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_staff
from app.core.database import get_db
from app.models.document_chunk import DocumentChunk
from app.models.user import User
from app.schemas.assistant import (
    AssistantQueryRequest,
    AssistantQueryResponse,
    IngestAccepted,
    KnowledgeDocumentOut,
)
from app.services.rag.router import answer_query
from app.services.storage import upload_document
from app.tasks.rag_ingestion import ingest_kb_document

router = APIRouter(prefix="/assistant", tags=["assistant"])

_ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}


@router.post("/query", response_model=AssistantQueryResponse)
def assistant_query(
    payload: AssistantQueryRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Answer a natural-language question via intent routing over the RAG skills.

    Staff only : la compétence candidate_search renvoie le profil, la formation
    et les compétences de TOUS les candidats, et matching_explanation le détail
    du score de n'importe quelle affectation. Un simple utilisateur authentifié
    y lisait les dossiers des autres.
    """
    return answer_query(
        db,
        query=payload.query,
        assignment_id=payload.assignment_id,
        min_years_experience=payload.min_years_experience,
        education_level=payload.education_level,
        top_k=payload.top_k,
    )


@router.post(
    "/documents",
    response_model=IngestAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_knowledge_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Upload a policy/process document and queue its ingestion (staff only).

    Chunking + embedding runs in Celery — large PDFs would exceed request
    timeouts if processed synchronously.
    """
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format non supporté (PDF, DOCX ou TXT attendu)",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Fichier vide")

    source_document = (title or file.filename or "document").strip()
    object_key = upload_document(data, file.filename or "document", file.content_type)
    task = ingest_kb_document.delay(
        object_key=object_key,
        source_document=source_document,
        filename=file.filename or "document",
        content_type=file.content_type,
    )
    return IngestAccepted(source_document=source_document, task_id=task.id)


@router.get("/documents", response_model=list[KnowledgeDocumentOut])
def list_knowledge_documents(
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """List ingested knowledge-base documents with their chunk counts."""
    rows = (
        db.query(DocumentChunk.source_document, func.count(DocumentChunk.id))
        .group_by(DocumentChunk.source_document)
        .order_by(DocumentChunk.source_document)
        .all()
    )
    return [KnowledgeDocumentOut(source_document=name, chunks=count) for name, count in rows]


@router.delete("/documents/{source_document}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_document(
    source_document: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Remove all chunks of an ingested document from the knowledge base."""
    deleted = (
        db.query(DocumentChunk).filter(DocumentChunk.source_document == source_document).delete()
    )
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Document introuvable")
