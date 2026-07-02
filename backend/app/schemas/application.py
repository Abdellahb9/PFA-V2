"""Application schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.application import ApplicationStatus
from app.schemas.candidate import CandidateOut


class DocumentOut(BaseModel):
    id: int
    kind: str
    filename: str
    content_type: str | None = None
    size: int

    model_config = {"from_attributes": True}


class ApplicationOut(BaseModel):
    id: int
    candidate_id: int
    offer_id: int | None
    status: ApplicationStatus
    motivation: str | None
    match_score: float | None
    parsed_at: datetime | None
    created_at: datetime
    candidate: CandidateOut | None = None
    documents: list[DocumentOut] = []

    model_config = {"from_attributes": True}


class ApplicationStatusUpdate(BaseModel):
    status: ApplicationStatus


class ApplicationSubmitResponse(BaseModel):
    """Minimal confirmation returned by the public submission endpoint.

    Deliberately does NOT echo the candidate profile, so the public endpoint
    cannot be used to enumerate/leak existing candidates by email.
    """

    id: int
    status: ApplicationStatus
    message: str = "Candidature reçue."
