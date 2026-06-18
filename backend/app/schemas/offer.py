"""Internship offer schemas."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.models.offer import OfferStatus
from app.schemas.skill import SkillRef


class OfferSkillOut(BaseModel):
    name: str
    weight: float
    required: bool

    model_config = {"from_attributes": True}


class OfferBase(BaseModel):
    title: str
    description: str | None = None
    field: str | None = None
    slots: int = 1
    min_education_level: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: OfferStatus = OfferStatus.OPEN


class OfferCreate(OfferBase):
    department_id: int
    # Required skills with importance weights.
    skills: list[SkillRef] = []


class OfferUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    slots: int | None = None
    status: OfferStatus | None = None
    skills: list[SkillRef] | None = None


class OfferOut(OfferBase):
    id: int
    department_id: int
    skills: list[SkillRef] = []

    model_config = {"from_attributes": True}


class PublicOfferOut(BaseModel):
    """Read-only, non-sensitive view of an open offer for the public landing."""

    id: int
    title: str
    field: str | None = None
    department_name: str | None = None
    slots: int
    description: str | None = None
    skills: list[SkillRef] = []
