"""Schemas for the RAG assistant endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Intent = Literal["candidate_search", "matching_explanation", "policy_qa"]


class AssistantQueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    # Set to explain a specific matching score (forces matching_explanation).
    assignment_id: int | None = None
    # Optional structured filters for candidate search.
    min_years_experience: float | None = Field(default=None, ge=0)
    education_level: str | None = Field(default=None, max_length=120)
    top_k: int = Field(default=5, ge=1, le=20)


class AssistantQueryResponse(BaseModel):
    intent: Intent
    answer: str
    # Retrieved evidence (candidate profiles, score breakdown or doc chunks).
    sources: list[dict]


class KnowledgeDocumentOut(BaseModel):
    source_document: str
    chunks: int


class IngestAccepted(BaseModel):
    source_document: str
    task_id: str
    status: str = "queued"
