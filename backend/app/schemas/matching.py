"""Matching / assignment schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.assignment import AssignmentStatus
from app.models.matching_run import MatchingRunStatus


class MatchingWeights(BaseModel):
    """Weights for the composite score; should roughly sum to 1.0."""

    semantic: float = 0.5  # embedding cosine similarity
    skills: float = 0.35  # weighted skill overlap
    education: float = 0.15  # education-level fit


class MatchingRequest(BaseModel):
    weights: MatchingWeights = MatchingWeights()
    # If true, write proposed assignments to the DB; otherwise preview only.
    persist: bool = False
    # Minimum acceptable score; pairs below this are not assigned.
    min_score: float = 0.0


class AssignmentPreview(BaseModel):
    application_id: int
    candidate_id: int
    candidate_name: str
    offer_id: int
    offer_title: str
    department_name: str
    match_score: float
    score_breakdown: dict


class MatchingResult(BaseModel):
    matching_run_id: int | None
    algorithm: str
    total_candidates: int
    total_slots: int
    assignments_count: int
    total_score: float
    average_score: float
    persisted: bool
    assignments: list[AssignmentPreview]


class AssignmentOut(BaseModel):
    id: int
    application_id: int
    candidate_id: int
    offer_id: int
    match_score: float
    score_breakdown: dict | None
    status: AssignmentStatus
    decided_by: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MatchingRunOut(BaseModel):
    id: int
    algorithm: str
    status: MatchingRunStatus
    total_candidates: int
    total_slots: int
    assignments_count: int
    total_score: float
    average_score: float
    created_at: datetime

    model_config = {"from_attributes": True}
