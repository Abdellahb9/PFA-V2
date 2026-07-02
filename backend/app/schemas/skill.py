"""Skill schemas."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.skill import SkillCategory


class SkillBase(BaseModel):
    name: str
    category: SkillCategory = SkillCategory.TECHNICAL


class SkillCreate(SkillBase):
    pass


class SkillOut(SkillBase):
    id: int
    normalized: str

    model_config = {"from_attributes": True}


class SkillRef(BaseModel):
    """A skill reference with an associated weight (for candidate/offer links)."""

    # from_attributes lets this validate directly from ORM association objects
    # (CandidateSkill / OfferSkill), which expose `.name` and `.weight`.
    model_config = {"from_attributes": True}

    name: str
    weight: float = 1.0
