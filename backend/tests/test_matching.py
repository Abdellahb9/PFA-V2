"""Unit tests for the scoring + Hungarian assignment engine (no DB needed)."""
from __future__ import annotations

import numpy as np

from app.services.matching.hungarian import solve_assignment
from app.services.matching.scoring import (
    CandidateProfile,
    OfferProfile,
    composite_score,
    education_fit,
    skill_overlap,
)


def _vec(*xs: float) -> np.ndarray:
    return np.array(xs, dtype=float)


def test_skill_overlap_full_and_partial():
    offer = {"python": 1.0, "nlp": 1.0}
    assert skill_overlap({"python": 1.0, "nlp": 1.0}, offer) == 1.0
    assert skill_overlap({"python": 1.0}, offer) == 0.5
    assert skill_overlap({}, offer) == 0.0


def test_education_fit_levels():
    assert education_fit("Bac+5", "Bac+5") == 1.0
    assert education_fit("Bac+3", None) == 1.0          # no requirement
    assert education_fit("Bac+3", "Bac+5") < 1.0        # under-qualified
    assert education_fit("Bac+5", "Bac+3") == 1.0       # over-qualified is fine


def test_composite_score_in_range():
    cand = CandidateProfile(1, 1, "A", _vec(1, 0), {"python": 1.0}, "Bac+5")
    offer = OfferProfile(1, "Dev", "DSI", 1, _vec(1, 0), {"python": 1.0}, "Bac+3")
    score, breakdown = composite_score(cand, offer)
    assert 0.0 <= score <= 1.0
    assert set(breakdown) >= {"semantic", "skills", "education"}


def test_hungarian_maximises_total_score():
    # Two candidates, two offers; the optimal assignment is the diagonal.
    c1 = CandidateProfile(1, 1, "C1", _vec(1, 0), {"python": 1.0}, "Bac+5")
    c2 = CandidateProfile(2, 2, "C2", _vec(0, 1), {"chemistry": 1.0}, "Bac+5")
    o1 = OfferProfile(1, "Dev", "DSI", 1, _vec(1, 0), {"python": 1.0}, None)
    o2 = OfferProfile(2, "Chimie", "PROC", 1, _vec(0, 1), {"chemistry": 1.0}, None)

    outcome = solve_assignment([c1, c2], [o1, o2])
    assert outcome.assignments_count == 2
    mapping = {p.candidate_id: p.offer_id for p in outcome.pairs}
    assert mapping == {1: 1, 2: 2}


def test_hungarian_respects_capacity_slots():
    # One offer with 2 slots can take both candidates.
    c1 = CandidateProfile(1, 1, "C1", _vec(1, 0), {"python": 1.0}, None)
    c2 = CandidateProfile(2, 2, "C2", _vec(1, 0), {"python": 0.9}, None)
    o1 = OfferProfile(1, "Dev", "DSI", 2, _vec(1, 0), {"python": 1.0}, None)

    outcome = solve_assignment([c1, c2], [o1])
    assert outcome.total_slots == 2
    assert outcome.assignments_count == 2
