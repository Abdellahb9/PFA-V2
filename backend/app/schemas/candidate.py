"""Candidate schemas."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr

from app.schemas.skill import SkillRef


class CandidateBase(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    phone: str | None = None
    education_level: str | None = None
    field_of_study: str | None = None
    university: str | None = None
    years_experience: float = 0.0


class CandidateCreate(CandidateBase):
    skills: list[SkillRef] = []


class CandidateOut(CandidateBase):
    id: int
    full_name: str
    skills: list[SkillRef] = []
    has_embedding: bool = False

    model_config = {"from_attributes": True}
