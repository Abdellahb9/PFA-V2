"""Optimal intern assignment via the Hungarian algorithm (scipy).

The internship-assignment problem is a bipartite assignment problem: we want to
assign candidates to offer *slots* so that the total match score is maximised,
respecting each offer's capacity (number of slots).

Implementation:
  1. Expand each offer into ``slots`` identical columns (capacity handling).
  2. Build a score matrix S[i, j] = composite_score(candidate_i, slot_j).
  3. Convert to a cost matrix C = (max_score - S) and run
     ``scipy.optimize.linear_sum_assignment`` (which minimises total cost,
     i.e. maximises total score).
  4. Drop pairs below ``min_score`` and aggregate the results.

The matrix does not need to be square: scipy handles rectangular inputs and
simply leaves the surplus side unassigned.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import linear_sum_assignment

from app.services.matching.scoring import (
    CandidateProfile,
    OfferProfile,
    composite_score,
)


@dataclass
class MatchPair:
    """A single proposed assignment with its explainable score breakdown."""

    application_id: int
    candidate_id: int
    candidate_name: str
    offer_id: int
    offer_title: str
    department_name: str
    match_score: float
    score_breakdown: dict


@dataclass
class MatchingOutcome:
    total_candidates: int
    total_slots: int
    pairs: list[MatchPair]

    @property
    def assignments_count(self) -> int:
        return len(self.pairs)

    @property
    def total_score(self) -> float:
        return round(sum(p.match_score for p in self.pairs), 4)

    @property
    def average_score(self) -> float:
        if not self.pairs:
            return 0.0
        return round(self.total_score / len(self.pairs), 4)


def _expand_slots(offers: list[OfferProfile]) -> list[tuple[int, OfferProfile]]:
    """Expand offers into one column per available slot.

    Returns a list of (offer_index, offer) entries; the same offer appears
    ``offer.slots`` times so that several candidates can be assigned to it.
    """
    columns: list[tuple[int, OfferProfile]] = []
    for idx, offer in enumerate(offers):
        for _ in range(max(0, offer.slots)):
            columns.append((idx, offer))
    return columns


def solve_assignment(
    candidates: list[CandidateProfile],
    offers: list[OfferProfile],
    weights: dict[str, float] | None = None,
    min_score: float = 0.0,
) -> MatchingOutcome:
    """Run the Hungarian optimisation and return the proposed assignments."""
    weights = weights or {}
    w_sem = weights.get("semantic", 0.5)
    w_skl = weights.get("skills", 0.35)
    w_edu = weights.get("education", 0.15)

    slot_columns = _expand_slots(offers)
    n_candidates = len(candidates)
    n_slots = len(slot_columns)

    if n_candidates == 0 or n_slots == 0:
        return MatchingOutcome(n_candidates, n_slots, [])

    # Score matrix S[i, j] and a parallel breakdown matrix.
    score_matrix = np.zeros((n_candidates, n_slots), dtype=float)
    breakdowns: list[list[dict]] = [[{} for _ in range(n_slots)] for _ in range(n_candidates)]

    for i, cand in enumerate(candidates):
        for j, (_, offer) in enumerate(slot_columns):
            score, breakdown = composite_score(cand, offer, w_sem, w_skl, w_edu)
            score_matrix[i, j] = score
            breakdowns[i][j] = breakdown

    # Minimise cost == maximise score.
    cost_matrix = score_matrix.max() - score_matrix
    row_ind, col_ind = linear_sum_assignment(cost_matrix)

    pairs: list[MatchPair] = []
    seen_candidates: set[int] = set()
    for i, j in zip(row_ind, col_ind, strict=False):
        score = float(score_matrix[i, j])
        if score < min_score:
            continue
        cand = candidates[i]
        _, offer = slot_columns[j]
        # Guard against a candidate appearing twice (should not with rectangular
        # assignment, but keep it defensive).
        if cand.candidate_id in seen_candidates:
            continue
        seen_candidates.add(cand.candidate_id)
        pairs.append(
            MatchPair(
                application_id=cand.application_id,
                candidate_id=cand.candidate_id,
                candidate_name=cand.name,
                offer_id=offer.offer_id,
                offer_title=offer.title,
                department_name=offer.department_name,
                match_score=round(score, 4),
                score_breakdown=breakdowns[i][j],
            )
        )

    # Best matches first for a cleaner dashboard presentation.
    pairs.sort(key=lambda p: p.match_score, reverse=True)
    return MatchingOutcome(n_candidates, n_slots, pairs)
