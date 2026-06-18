"""Skill lookup / creation helpers (idempotent by normalized name)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.skill import Skill, SkillCategory
from app.services.nlp.skills_db import category_of, normalize


def get_or_create_skill(db: Session, name: str,
                        category: SkillCategory | None = None) -> Skill:
    """Return the existing skill for ``name`` or create it (normalized key)."""
    norm = normalize(name)
    skill = db.scalar(select(Skill).where(Skill.normalized == norm))
    if skill:
        return skill
    skill = Skill(
        name=name.strip(),
        normalized=norm,
        category=category or category_of(norm),
    )
    db.add(skill)
    db.flush()  # assign PK without committing the whole transaction
    return skill
