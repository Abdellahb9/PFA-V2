"""Unified semantic retrieval over the three RAG sources (pgvector).

All three skills share the same backbone: embed the query with the existing
sentence-transformers singleton, then cosine-search the relevant table.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session, joinedload

from app.models.assignment import Assignment
from app.models.candidate import Candidate, CandidateSkill
from app.models.document_chunk import DocumentChunk
from app.models.offer import InternshipOffer, OfferSkill
from app.services.nlp.embeddings import embed_text_cached as embed_text

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
        .options(joinedload(Candidate.skills).joinedload(CandidateSkill.skill))
        .filter(Candidate.embedding.isnot(None))
    )
    if min_years_experience is not None:
        stmt = stmt.filter(Candidate.years_experience >= min_years_experience)
    if education_level:
        stmt = stmt.filter(Candidate.education_level.ilike(f"%{_escape_like(education_level)}%"))
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
            "similarity": _cosine_similarity(distance),
        }
        for cand, distance in rows
    ]


def _escape_like(value: str) -> str:
    """Neutralise ``%`` et ``_``, sinon la saisie devient un motif joker."""
    return value.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


def _cosine_similarity(distance: float) -> float:
    """Distance cosinus pgvector -> score affichable dans [0, 1].

    ATTENTION à la lecture du chiffre : la distance vaut ``1 - cos`` et vit dans
    [0, 2], donc ce cadrage place deux vecteurs ORTHOGONAUX (aucun rapport) à
    0,5. Un profil sans lien affiche donc « 50 % », jamais 0 %. L'échelle utile
    va en pratique de 0,5 à 1,0.

    Elle n'a rien à voir avec le champ homonyme du socle serverless
    (netlify/functions/_shared/rag.ts), qui publie un rang ts_rank_cd : ne
    comparez jamais les deux valeurs.
    """
    return round(max(0.0, 1.0 - float(distance) / 2.0), 4)


def get_score_breakdown(db: Session, assignment_id: int) -> dict | None:
    """Everything needed to explain one assignment's match score.

    Not semantic retrieval: the ground truth already lives in
    ``Assignment.score_breakdown`` (JSONB) plus the candidate/offer profiles.
    """
    assignment = (
        db.query(Assignment)
        .options(
            joinedload(Assignment.candidate).joinedload(Candidate.skills).joinedload(
                CandidateSkill.skill
            ),
            joinedload(Assignment.offer).joinedload(InternshipOffer.required_skills).joinedload(
                OfferSkill.skill
            ),
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
            "required_skills": sorted(sk.name for sk in offer.required_skills),
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
            "similarity": _cosine_similarity(distance),
        }
        for chunk, distance in rows
    ]
