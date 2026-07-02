"""Unified semantic retrieval over the three RAG sources (pgvector).

All three skills share the same backbone: embed the query with the existing
sentence-transformers singleton, then cosine-search the relevant table.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session, joinedload

from app.models.assignment import Assignment
from app.models.candidate import Candidate
from app.models.document_chunk import DocumentChunk
from app.models.offer import InternshipOffer, OfferStatus
from app.services.nlp.embeddings import embed_text

logger = logging.getLogger(__name__)


def retrieve_candidates(
    db: Session,
    query: str,
    min_years_experience: float | None = None,
    education_level: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    """Semantic candidate search with optional structured filters."""
    query_vec = embed_text(query)
    stmt = (
        db.query(
            Candidate,
            Candidate.embedding.cosine_distance(query_vec).label("distance"),
        )
        .options(joinedload(Candidate.skills))
        .filter(Candidate.embedding.isnot(None))
    )
    if min_years_experience is not None:
        stmt = stmt.filter(Candidate.years_experience >= min_years_experience)
    if education_level:
        stmt = stmt.filter(Candidate.education_level.ilike(f"%{education_level}%"))
    rows = stmt.order_by("distance").limit(top_k).all()

    return [
        {
            "type": "candidate",
            "candidate_id": cand.id,
            "name": cand.full_name,
            "education_level": cand.education_level,
            "field_of_study": cand.field_of_study,
            "years_experience": cand.years_experience,
            "skills": sorted(cs.name for cs in cand.skills),
            # Normalised embeddings -> cosine distance in [0, 2]; map to [0, 1].
            "similarity": round(max(0.0, 1.0 - float(distance) / 2.0), 4),
        }
        for cand, distance in rows
    ]


def retrieve_offers(db: Session, query: str, top_k: int = 5) -> list[dict]:
    """Semantic search over open internship offers."""
    query_vec = embed_text(query)
    rows = (
        db.query(
            InternshipOffer,
            InternshipOffer.embedding.cosine_distance(query_vec).label("distance"),
        )
        .options(
            joinedload(InternshipOffer.required_skills), joinedload(InternshipOffer.department)
        )
        .filter(
            InternshipOffer.embedding.isnot(None),
            InternshipOffer.status == OfferStatus.OPEN,
        )
        .order_by("distance")
        .limit(top_k)
        .all()
    )
    return [
        {
            "type": "offer",
            "offer_id": offer.id,
            "title": offer.title,
            "department": offer.department.name if offer.department else None,
            "min_education_level": offer.min_education_level,
            "required_skills": sorted(os.name for os in offer.required_skills),
            "similarity": round(max(0.0, 1.0 - float(distance) / 2.0), 4),
        }
        for offer, distance in rows
    ]


def get_score_breakdown(db: Session, assignment_id: int) -> dict | None:
    """Everything needed to explain one assignment's match score.

    Not semantic retrieval: the ground truth already lives in
    ``Assignment.score_breakdown`` (JSONB) plus the candidate/offer profiles.
    """
    assignment = (
        db.query(Assignment)
        .options(
            joinedload(Assignment.candidate).joinedload(Candidate.skills),
            joinedload(Assignment.offer).joinedload(InternshipOffer.required_skills),
        )
        .filter(Assignment.id == assignment_id)
        .first()
    )
    if assignment is None:
        return None
    cand, offer = assignment.candidate, assignment.offer
    return {
        "type": "matching_explanation",
        "assignment_id": assignment.id,
        "match_score": assignment.match_score,
        "score_breakdown": assignment.score_breakdown,
        "status": assignment.status.value,
        "candidate": {
            "name": cand.full_name,
            "education_level": cand.education_level,
            "field_of_study": cand.field_of_study,
            "years_experience": cand.years_experience,
            "skills": sorted(cs.name for cs in cand.skills),
        },
        "offer": {
            "title": offer.title,
            "min_education_level": offer.min_education_level,
            "required_skills": sorted(os.name for os in offer.required_skills),
        },
    }


def retrieve_doc_chunks(db: Session, query: str, top_k: int = 5) -> list[dict]:
    """Top-k policy document chunks for classic RAG question answering."""
    query_vec = embed_text(query)
    rows = (
        db.query(
            DocumentChunk,
            DocumentChunk.embedding.cosine_distance(query_vec).label("distance"),
        )
        .filter(DocumentChunk.embedding.isnot(None))
        .order_by("distance")
        .limit(top_k)
        .all()
    )
    return [
        {
            "type": "doc_chunk",
            "source_document": chunk.source_document,
            "chunk_index": chunk.chunk_index,
            "text": chunk.chunk_text,
            "similarity": round(max(0.0, 1.0 - float(distance) / 2.0), 4),
        }
        for chunk, distance in rows
    ]
