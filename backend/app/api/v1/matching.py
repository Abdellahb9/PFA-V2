"""Matching endpoints: run optimisation, list runs, manage assignments."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_staff
from app.core.database import get_db
from app.models.application import Application, ApplicationStatus
from app.models.assignment import Assignment, AssignmentStatus
from app.models.matching_run import MatchingRun
from app.models.user import User
from app.schemas.matching import (
    AssignmentOut,
    MatchingRequest,
    MatchingResult,
    MatchingRunOut,
)
from app.services.matching.service import run_matching

router = APIRouter(prefix="/matching", tags=["matching"])


@router.post("/run", response_model=MatchingResult)
def run(
    body: MatchingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    """Run the Hungarian optimisation. Preview by default, persist if requested."""
    result = run_matching(
        db,
        weights=body.weights.model_dump(),
        persist=body.persist,
        min_score=body.min_score,
        triggered_by=current_user.email,
    )
    return result


@router.get("/runs", response_model=list[MatchingRunOut])
def list_runs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(MatchingRun).order_by(MatchingRun.created_at.desc())).all()


@router.get("/assignments", response_model=list[AssignmentOut])
def list_assignments(
    status: AssignmentStatus | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Assignment).order_by(Assignment.match_score.desc())
    if status:
        stmt = stmt.where(Assignment.status == status)
    return db.scalars(stmt).all()


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
def decide_assignment(
    assignment_id: int,
    status: AssignmentStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    """Confirm or reject a proposed assignment.

    Confirming marks the underlying application as ASSIGNED; rejecting reverts
    it to UNDER_REVIEW so it can be re-matched.
    """
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Affectation introuvable")

    assignment.status = status
    assignment.decided_by = current_user.email

    app = db.get(Application, assignment.application_id)
    if app:
        if status == AssignmentStatus.CONFIRMED:
            app.status = ApplicationStatus.ASSIGNED
        elif status == AssignmentStatus.REJECTED:
            app.status = ApplicationStatus.UNDER_REVIEW

    db.commit()
    db.refresh(assignment)
    return assignment
