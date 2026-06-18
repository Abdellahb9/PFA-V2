"""Composite candidate <-> offer scoring used by the matching engine.

The final score is a weighted blend of three interpretable components:

    score = w_semantic * semantic_similarity
          + w_skills   * weighted_skill_overlap
          + w_education * education_fit

All components and the final score live in [0, 1]. A per-pair breakdown is
returned alongside the score for explainability in the admin dashboard.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Ordinal ranking of education levels used to compute education fit.
_EDUCATION_RANK: dict[str, int] = {
    "bac": 1,
    "bac+1": 2,
    "bac+2": 3,
    "dut": 3,
    "bts": 3,
    "licence": 4,
    "bac+3": 4,
    "bachelor": 4,
    "master 1": 5,
    "bac+4": 5,
    "master": 6,
    "master 2": 6,
    "bac+5": 6,
    "ingenieur": 6,
    "engineer": 6,
    "doctorat": 7,
    "phd": 7,
}


@dataclass
class CandidateProfile:
    """Lightweight, matching-ready view of a candidate."""

    candidate_id: int
    application_id: int
    name: str
    embedding: np.ndarray | None
    # skill normalized name -> weight in [0, 1]
    skills: dict[str, float]
    education_level: str | None


@dataclass
class OfferProfile:
    """Lightweight, matching-ready view of an internship offer."""

    offer_id: int
    title: str
    department_name: str
    slots: int
    embedding: np.ndarray | None
    skills: dict[str, float]   # required skill -> importance weight
    min_education_level: str | None


def _normalize_level(level: str | None) -> int | None:
    if not level:
        return None
    return _EDUCATION_RANK.get(level.strip().lower())


def semantic_similarity(a: np.ndarray | None, b: np.ndarray | None) -> float:
    """Cosine similarity between two embeddings, rescaled to [0, 1]."""
    if a is None or b is None:
        return 0.0
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    cos = float(np.dot(a, b) / (na * nb))
    # Cosine is in [-1, 1]; map to [0, 1].
    return max(0.0, min(1.0, (cos + 1.0) / 2.0))


def skill_overlap(candidate_skills: dict[str, float],
                  offer_skills: dict[str, float]) -> float:
    """Weighted overlap: share of the offer's importance covered by the candidate."""
    if not offer_skills:
        return 0.0
    total_weight = sum(offer_skills.values())
    if total_weight == 0:
        return 0.0
    matched = 0.0
    for skill, importance in offer_skills.items():
        if skill in candidate_skills:
            # Candidate proficiency modulates how much of the importance is met.
            matched += importance * min(1.0, candidate_skills[skill])
    return max(0.0, min(1.0, matched / total_weight))


def education_fit(candidate_level: str | None, min_level: str | None) -> float:
    """1.0 if the candidate meets/exceeds the required level, decaying below it."""
    required = _normalize_level(min_level)
    if required is None:
        return 1.0  # no requirement -> neutral/full fit
    have = _normalize_level(candidate_level)
    if have is None:
        return 0.5  # unknown candidate level -> neutral
    if have >= required:
        return 1.0
    # One level short -> 0.6, two -> 0.2, then floor at 0.
    return max(0.0, 1.0 - 0.4 * (required - have))


def composite_score(
    candidate: CandidateProfile,
    offer: OfferProfile,
    w_semantic: float = 0.5,
    w_skills: float = 0.35,
    w_education: float = 0.15,
) -> tuple[float, dict]:
    """Return the blended score and a breakdown dict for one (candidate, offer) pair."""
    sem = semantic_similarity(candidate.embedding, offer.embedding)
    skl = skill_overlap(candidate.skills, offer.skills)
    edu = education_fit(candidate.education_level, offer.min_education_level)

    total_w = w_semantic + w_skills + w_education or 1.0
    score = (w_semantic * sem + w_skills * skl + w_education * edu) / total_w

    breakdown = {
        "semantic": round(sem, 4),
        "skills": round(skl, 4),
        "education": round(edu, 4),
        "weights": {
            "semantic": w_semantic,
            "skills": w_skills,
            "education": w_education,
        },
    }
    return round(float(score), 4), breakdown
