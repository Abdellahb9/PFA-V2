"""Cross-stack scoring parity: Python engine vs netlify/functions/_shared/scoring.ts.

Both test suites consume the same golden fixtures (shared/fixtures/scoring-parity.json),
so a change to one implementation that is not mirrored in the other fails CI on
whichever side drifted. The serverless engine has no semantic component, hence
composite cases are checked here with w_semantic=0 (embeddings absent).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.matching.scoring import (
    CandidateProfile,
    OfferProfile,
    composite_score,
    education_fit,
    skill_overlap,
)

_FIXTURES = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "scoring-parity.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", _FIXTURES["educationFit"], ids=lambda c: c["name"])
def test_education_fit_parity(case: dict) -> None:
    assert education_fit(case["candidate"], case["required"]) == pytest.approx(
        case["expected"], abs=1e-4
    )


@pytest.mark.parametrize("case", _FIXTURES["skillOverlap"], ids=lambda c: c["name"])
def test_skill_overlap_parity(case: dict) -> None:
    assert skill_overlap(case["candidate"], case["offer"]) == pytest.approx(
        case["expected"], abs=1e-4
    )


@pytest.mark.parametrize("case", _FIXTURES["composite"], ids=lambda c: c["name"])
def test_composite_score_parity(case: dict) -> None:
    candidate = CandidateProfile(
        candidate_id=1,
        application_id=1,
        name="Parity",
        embedding=None,
        skills=case["candidateSkills"],
        education_level=case["candidateLevel"],
    )
    offer = OfferProfile(
        offer_id=1,
        title="Parity",
        department_name="DSI",
        slots=1,
        embedding=None,
        skills=case["offerSkills"],
        min_education_level=case["minLevel"],
    )
    score, _ = composite_score(
        candidate,
        offer,
        w_semantic=0.0,
        w_skills=case["wSkills"],
        w_education=case["wEducation"],
    )
    assert score == pytest.approx(case["expected"], abs=1e-4)
