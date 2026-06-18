"""Candidate endpoints (list / detail with extracted skills)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.candidate import Candidate
from app.models.user import User
from app.schemas.candidate import CandidateOut
from app.schemas.skill import SkillRef

router = APIRouter(prefix="/candidates", tags=["candidates"])


def _serialize(cand: Candidate) -> CandidateOut:
    out = CandidateOut.model_validate(cand)
    out.full_name = cand.full_name
    out.has_embedding = cand.embedding is not None
    out.skills = [SkillRef(name=cs.skill.name, weight=cs.weight) for cs in cand.skills]
    return out


@router.get("", response_model=list[CandidateOut])
def list_candidates(
    search: str | None = Query(None, description="Filtre par nom ou filière"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Candidate)
        .options(selectinload(Candidate.skills))
        .order_by(Candidate.created_at.desc())
    )
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            (Candidate.last_name.ilike(like))
            | (Candidate.first_name.ilike(like))
            | (Candidate.field_of_study.ilike(like))
        )
    return [_serialize(c) for c in db.scalars(stmt).all()]


@router.get("/{candidate_id}", response_model=CandidateOut)
def get_candidate(candidate_id: int, db: Session = Depends(get_db),
                  _: User = Depends(get_current_user)):
    cand = db.get(Candidate, candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidat introuvable")
    return _serialize(cand)
