"""Bridge between the database and the Hungarian matching engine.

Loads candidate/offer profiles from the DB, runs the optimisation and
(optionally) persists the resulting assignments + a MatchingRun record.
"""
from __future__ import annotations

import logging

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.application import Application, ApplicationStatus
from app.models.assignment import Assignment, AssignmentStatus
from app.models.candidate import Candidate
from app.models.matching_run import MatchingRun, MatchingRunStatus
from app.models.offer import InternshipOffer, OfferStatus
from app.services.matching.hungarian import solve_assignment
from app.services.matching.scoring import CandidateProfile, OfferProfile, composite_score

logger = logging.getLogger(__name__)


def compute_application_best_score(db: Session, application_id: int) -> float | None:
    """Compute and store an application's best-fit score across open offers.

    This gives immediate feedback after a CV is parsed (an indicative score),
    independent of the global Hungarian assignment which is run separately.
    """
    app = db.get(Application, application_id)
    if app is None or app.candidate is None:
        return None
    cand = app.candidate
    skills = {cs.skill.normalized: cs.weight for cs in cand.skills}
    emb = np.asarray(cand.embedding, dtype=float) if cand.embedding is not None else None
    cprofile = CandidateProfile(
        candidate_id=cand.id,
        application_id=app.id,
        name=cand.full_name,
        embedding=emb,
        skills=skills,
        education_level=cand.education_level,
    )
    offers = _load_offer_profiles(db)
    if not offers:
        return None
    best = max(composite_score(cprofile, offer)[0] for offer in offers)
    app.match_score = round(float(best), 4)
    db.commit()
    return app.match_score


def _load_candidate_profiles(db: Session) -> list[CandidateProfile]:
    """Build matching profiles for applications ready to be assigned."""
    stmt = (
        select(Application)
        .where(Application.status.in_([ApplicationStatus.PARSED, ApplicationStatus.UNDER_REVIEW]))
        .options(
            selectinload(Application.candidate).selectinload(Candidate.skills)
        )
    )
    profiles: list[CandidateProfile] = []
    for app in db.scalars(stmt).all():
        cand = app.candidate
        if cand is None:
            continue
        skills = {cs.skill.normalized: cs.weight for cs in cand.skills}
        emb = np.asarray(cand.embedding, dtype=float) if cand.embedding is not None else None
        profiles.append(
            CandidateProfile(
                candidate_id=cand.id,
                application_id=app.id,
                name=cand.full_name,
                embedding=emb,
                skills=skills,
                education_level=cand.education_level,
            )
        )
    return profiles


def _load_offer_profiles(db: Session) -> list[OfferProfile]:
    """Build matching profiles for all open offers with free slots."""
    stmt = (
        select(InternshipOffer)
        .where(InternshipOffer.status == OfferStatus.OPEN)
        .options(
            selectinload(InternshipOffer.required_skills),
            selectinload(InternshipOffer.department),
        )
    )
    profiles: list[OfferProfile] = []
    for offer in db.scalars(stmt).all():
        skills = {os.skill.normalized: os.weight for os in offer.required_skills}
        emb = np.asarray(offer.embedding, dtype=float) if offer.embedding is not None else None
        profiles.append(
            OfferProfile(
                offer_id=offer.id,
                title=offer.title,
                department_name=offer.department.name if offer.department else "",
                slots=offer.slots,
                embedding=emb,
                skills=skills,
                min_education_level=offer.min_education_level,
            )
        )
    return profiles


def run_matching(
    db: Session,
    weights: dict[str, float] | None = None,
    persist: bool = False,
    min_score: float = 0.0,
    triggered_by: str | None = None,
) -> dict:
    """Run the global assignment and return a serialisable result dict."""
    candidates = _load_candidate_profiles(db)
    offers = _load_offer_profiles(db)
    outcome = solve_assignment(candidates, offers, weights=weights, min_score=min_score)

    run_id: int | None = None
    if persist:
        run = MatchingRun(
            algorithm="hungarian",
            status=MatchingRunStatus.RUNNING,
            total_candidates=outcome.total_candidates,
            total_slots=outcome.total_slots,
            params=weights,
            triggered_by=triggered_by,
        )
        db.add(run)
        db.flush()
        run_id = run.id

        for pair in outcome.pairs:
            # Replace any previous proposed assignment for this application.
            existing = db.scalar(
                select(Assignment).where(Assignment.application_id == pair.application_id)
            )
            if existing and existing.status == AssignmentStatus.CONFIRMED:
                continue  # never overwrite a human-confirmed assignment
            if existing:
                db.delete(existing)
                db.flush()

            db.add(
                Assignment(
                    application_id=pair.application_id,
                    candidate_id=pair.candidate_id,
                    offer_id=pair.offer_id,
                    matching_run_id=run_id,
                    match_score=pair.match_score,
                    score_breakdown=pair.score_breakdown,
                    status=AssignmentStatus.PROPOSED,
                )
            )
            # Reflect the best score on the application.
            app = db.get(Application, pair.application_id)
            if app:
                app.match_score = pair.match_score

        run.status = MatchingRunStatus.COMPLETED
        run.assignments_count = outcome.assignments_count
        run.total_score = outcome.total_score
        run.average_score = outcome.average_score
        db.commit()

    return {
        "matching_run_id": run_id,
        "algorithm": "hungarian",
        "total_candidates": outcome.total_candidates,
        "total_slots": outcome.total_slots,
        "assignments_count": outcome.assignments_count,
        "total_score": outcome.total_score,
        "average_score": outcome.average_score,
        "persisted": persist,
        "assignments": [
            {
                "application_id": p.application_id,
                "candidate_id": p.candidate_id,
                "candidate_name": p.candidate_name,
                "offer_id": p.offer_id,
                "offer_title": p.offer_title,
                "department_name": p.department_name,
                "match_score": p.match_score,
                "score_breakdown": p.score_breakdown,
            }
            for p in outcome.pairs
        ],
    }
