"""Application endpoints: submission (with CV upload) + listing + review."""

from __future__ import annotations

import io
import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_staff
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.models.application import Application, ApplicationStatus
from app.models.candidate import Candidate
from app.models.document import Document, DocumentKind
from app.models.user import User
from app.schemas.application import (
    ApplicationOut,
    ApplicationStatusUpdate,
    ApplicationSubmitResponse,
)
from app.services.storage import delete_document, download_document, upload_document
from app.tasks.cv_analysis import analyze_application

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applications", tags=["applications"])

# 10 MB upload guard.
_MAX_BYTES = 10 * 1024 * 1024

# Allowed upload types -> their magic-byte signature (validate real content,
# not just the file extension). DOCX is a ZIP container ("PK\x03\x04").
_ALLOWED_SIGNATURES: dict[str, bytes] = {
    ".pdf": b"%PDF",
    ".docx": b"PK\x03\x04",
}

# Public submissions: max 5 per IP per hour (staff bypass — see rate_limit()).
_apply_rate_limit = rate_limit("apply", limit=5, window_seconds=3600)


@router.get("", response_model=list[ApplicationOut])
def list_applications(
    status: ApplicationStatus | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Application)
        .options(
            selectinload(Application.candidate).selectinload(Candidate.skills),
            selectinload(Application.documents),
        )
        .order_by(Application.created_at.desc())
    )
    if status:
        stmt = stmt.where(Application.status == status)
    return db.scalars(stmt).all()


@router.post("", response_model=ApplicationSubmitResponse, status_code=201)
async def submit_application(
    first_name: str = Form(..., min_length=1, max_length=120),
    last_name: str = Form(..., min_length=1, max_length=120),
    email: str = Form(..., min_length=3, max_length=255),
    phone: str | None = Form(None, max_length=40),
    field_of_study: str | None = Form(None, max_length=180),
    education_level: str | None = Form(None, max_length=120),
    university: str | None = Form(None, max_length=200),
    motivation: str | None = Form(None, max_length=4000),
    offer_id: int | None = Form(None),
    cv: UploadFile = File(...),
    cover_letter: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    _rl: None = Depends(_apply_rate_limit),
):
    """Submit an internship application with a CV (and optional cover letter).

    Creates/links the candidate, stores files in MinIO, then queues the async
    NLP analysis task. **Public** (candidate portal): no authentication, but
    rate-limited per IP and strict file validation (see ``_store_upload``).
    Returns only a minimal confirmation (no candidate profile is echoed).
    """
    # Reuse an existing candidate by email, otherwise create a new one.
    candidate = db.scalar(select(Candidate).where(Candidate.email == email))
    if candidate is None:
        candidate = Candidate(
            first_name=first_name,
            last_name=last_name,
            email=email,
            phone=phone,
            field_of_study=field_of_study,
            education_level=education_level,
            university=university,
        )
        db.add(candidate)
        db.flush()

    application = Application(
        candidate_id=candidate.id,
        offer_id=offer_id,
        motivation=motivation,
        status=ApplicationStatus.SUBMITTED,
    )
    db.add(application)
    db.flush()

    # Store the CV (required) and the cover letter (optional).
    await _store_upload(db, application.id, cv, DocumentKind.CV)
    if cover_letter is not None:
        await _store_upload(db, application.id, cover_letter, DocumentKind.COVER_LETTER)

    db.commit()
    db.refresh(application)

    # Kick off asynchronous parsing + profiling.
    analyze_application.delay(application.id)

    # Minimal, public-safe confirmation (no candidate data echoed back).
    return ApplicationSubmitResponse(id=application.id, status=application.status)


async def _store_upload(
    db: Session, application_id: int, file: UploadFile, kind: DocumentKind
) -> None:
    """Validate size + real file type, upload to MinIO and record a Document row."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Fichier vide")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Fichier trop volumineux: {file.filename}")

    # Enforce PDF/DOCX by extension AND by magic bytes (not just the extension).
    name = (file.filename or "").lower()
    ext = next((e for e in _ALLOWED_SIGNATURES if name.endswith(e)), None)
    if ext is None:
        raise HTTPException(status_code=415, detail="Format non supporté : PDF ou DOCX uniquement")
    if not data.startswith(_ALLOWED_SIGNATURES[ext]):
        raise HTTPException(
            status_code=415,
            detail="Le contenu du fichier ne correspond pas à un PDF/DOCX valide",
        )

    object_key = upload_document(data, file.filename or "document", file.content_type)
    db.add(
        Document(
            application_id=application_id,
            kind=kind,
            filename=file.filename or "document",
            object_key=object_key,
            content_type=file.content_type,
            size=len(data),
        )
    )


@router.get("/{application_id}", response_model=ApplicationOut)
def get_application(
    application_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    app = db.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    return app


@router.patch("/{application_id}/status", response_model=ApplicationOut)
def update_status(
    application_id: int,
    body: ApplicationStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    app = db.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    app.status = body.status
    db.commit()
    db.refresh(app)
    return app


@router.post("/{application_id}/reanalyze", response_model=ApplicationOut)
def reanalyze(application_id: int, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    """Re-trigger the NLP analysis for an application."""
    app = db.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    analyze_application.delay(application_id)
    return app


@router.delete("/{application_id}", status_code=204)
def delete_application(
    application_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Delete an application (leaf entity).

    Cascades to its documents and assignment (ORM + DB ``ON DELETE CASCADE``),
    and removes the stored files from object storage (best-effort).
    """
    app = db.get(Application, application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Candidature introuvable")
    # Best-effort removal of stored files before deleting the DB rows.
    for doc in app.documents:
        try:
            delete_document(doc.object_key)
        except Exception as exc:  # pragma: no cover - storage cleanup is non-fatal
            logger.warning("Could not delete object %s: %s", doc.object_key, exc)
    db.delete(app)
    db.commit()


@router.get("/{application_id}/documents/{document_id}/download")
def download_application_document(
    application_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Stream a stored document (CV / cover letter) back through the API.

    The browser cannot reach MinIO's internal endpoint (minio:9000), so the
    backend fetches the object and streams it. ``inline`` lets PDFs preview in
    the browser instead of forcing a download.
    """
    doc = db.get(Document, document_id)
    if not doc or doc.application_id != application_id:
        raise HTTPException(status_code=404, detail="Document introuvable")
    data = download_document(doc.object_key)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=doc.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )
