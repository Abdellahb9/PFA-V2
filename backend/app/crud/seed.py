"""Idempotent database seeding: bootstrap admin, departments, offers, demo data.

Runs on application startup. Safe to call repeatedly — it only inserts records
that are not already present.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.crud.skill import get_or_create_skill
from app.models.application import Application, ApplicationStatus
from app.models.candidate import Candidate, CandidateSkill
from app.models.department import Department
from app.models.offer import InternshipOffer, OfferSkill, OfferStatus
from app.models.user import User, UserRole
from app.services.nlp.embeddings import embed_text
from app.services.nlp.pipeline import build_offer_text

logger = logging.getLogger(__name__)


def _seed_admin(db: Session) -> None:
    if db.scalar(select(User).where(User.email == settings.FIRST_ADMIN_EMAIL)):
        return
    db.add(
        User(
            email=settings.FIRST_ADMIN_EMAIL,
            hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
            full_name="Administrateur PHOSBOUCRAA",
            role=UserRole.ADMIN,
        )
    )
    logger.info("Seeded admin user %s", settings.FIRST_ADMIN_EMAIL)


# (code, name, capacity, supervisor)
_DEPARTMENTS = [
    ("DSI", "Direction des Systèmes d'Information", 4, "M. El Amrani"),
    ("MAINT", "Maintenance Industrielle", 3, "Mme Bennani"),
    ("PROC", "Génie des Procédés", 3, "M. Tazi"),
    ("QHSE", "Qualité, Hygiène, Sécurité & Environnement", 2, "Mme Idrissi"),
    ("RH", "Ressources Humaines", 2, "M. Ouali"),
]

# (dept_code, title, field, slots, min_level, [(skill, weight, required)])
_OFFERS = [
    (
        "DSI",
        "Stage Développement IA / NLP",
        "Informatique",
        2,
        "Bac+5",
        [
            ("python", 1.0, True),
            ("nlp", 0.9, True),
            ("machine learning", 0.8, False),
            ("docker", 0.5, False),
            ("sql", 0.6, False),
        ],
    ),
    (
        "DSI",
        "Stage Data Science",
        "Data Science",
        1,
        "Bac+4",
        [
            ("python", 1.0, True),
            ("data science", 0.9, True),
            ("sql", 0.7, False),
            ("machine learning", 0.7, False),
        ],
    ),
    (
        "MAINT",
        "Stage Automatisme & GMAO",
        "Génie électrique",
        2,
        "Bac+3",
        [
            ("automation", 1.0, True),
            ("electrical engineering", 0.8, True),
            ("maintenance", 0.7, False),
        ],
    ),
    (
        "PROC",
        "Stage Optimisation des Procédés",
        "Génie des procédés",
        2,
        "Bac+5",
        [
            ("process engineering", 1.0, True),
            ("chemistry", 0.7, False),
            ("data analysis", 0.6, False),
        ],
    ),
    (
        "QHSE",
        "Stage Système Qualité ISO 9001",
        "Qualité",
        1,
        "Bac+3",
        [("quality", 1.0, True), ("communication", 0.5, False)],
    ),
]

# (first, last, email, field, level, [(skill, weight)])
_CANDIDATES = [
    (
        "Youssef",
        "El Khattabi",
        "youssef.elk@example.ma",
        "Informatique",
        "Bac+5",
        [("python", 0.9), ("nlp", 0.8), ("machine learning", 0.8), ("docker", 0.6)],
    ),
    (
        "Salma",
        "Benjelloun",
        "salma.benj@example.ma",
        "Data Science",
        "Bac+5",
        [("python", 0.9), ("data science", 0.9), ("sql", 0.8), ("machine learning", 0.7)],
    ),
    (
        "Omar",
        "Fassi",
        "omar.fassi@example.ma",
        "Génie électrique",
        "Bac+3",
        [("automation", 0.9), ("electrical engineering", 0.8), ("maintenance", 0.6)],
    ),
    (
        "Imane",
        "Cherkaoui",
        "imane.cherk@example.ma",
        "Génie des procédés",
        "Bac+5",
        [("process engineering", 0.9), ("chemistry", 0.7), ("data analysis", 0.6)],
    ),
    (
        "Mehdi",
        "Alaoui",
        "mehdi.alaoui@example.ma",
        "Qualité",
        "Bac+3",
        [("quality", 0.9), ("communication", 0.7)],
    ),
    (
        "Nadia",
        "Bouhaddou",
        "nadia.bouh@example.ma",
        "Informatique",
        "Bac+4",
        [("python", 0.7), ("sql", 0.7), ("data analysis", 0.6)],
    ),
]


def _seed_departments(db: Session) -> dict[str, Department]:
    existing = {d.code: d for d in db.scalars(select(Department)).all()}
    for code, name, capacity, supervisor in _DEPARTMENTS:
        if code in existing:
            continue
        dept = Department(code=code, name=name, capacity=capacity, supervisor_name=supervisor)
        db.add(dept)
        existing[code] = dept
    db.flush()
    return existing


def _seed_offers(db: Session, departments: dict[str, Department]) -> None:
    if db.scalar(select(func.count(InternshipOffer.id))):
        return  # offers already seeded
    for dept_code, title, field, slots, min_level, skills in _OFFERS:
        dept = departments[dept_code]
        offer = InternshipOffer(
            department_id=dept.id,
            title=title,
            field=field,
            slots=slots,
            min_education_level=min_level,
            status=OfferStatus.OPEN,
            start_date=date(2026, 7, 1),
            end_date=date(2026, 9, 30),
            description=f"Stage au sein du département {dept.name}.",
        )
        db.add(offer)
        db.flush()
        skill_names = []
        for skill_name, weight, required in skills:
            skill = get_or_create_skill(db, skill_name)
            offer.required_skills.append(
                OfferSkill(skill_id=skill.id, weight=weight, required=required)
            )
            skill_names.append(skill_name)
        offer.embedding = embed_text(build_offer_text(title, offer.description, field, skill_names))


def _seed_candidates(db: Session) -> None:
    if db.scalar(select(func.count(Candidate.id))):
        return  # candidates already seeded
    for first, last, email, field, level, skills in _CANDIDATES:
        skill_text = " ".join(s for s, _ in skills)
        cand = Candidate(
            first_name=first,
            last_name=last,
            email=email,
            field_of_study=field,
            education_level=level,
            cv_text=f"{first} {last} - {field} - {level} - {skill_text}",
            embedding=embed_text(f"{field} {level} {skill_text}"),
        )
        db.add(cand)
        db.flush()
        for skill_name, weight in skills:
            skill = get_or_create_skill(db, skill_name)
            cand.skills.append(CandidateSkill(skill_id=skill.id, weight=weight))
        # A parsed application ready for matching.
        db.add(
            Application(
                candidate_id=cand.id,
                status=ApplicationStatus.PARSED,
                motivation=f"Candidature de {first} pour un stage en {field}.",
            )
        )


def seed_all(db: Session) -> None:
    """Run all seeders inside a single transaction."""
    try:
        _seed_admin(db)
        departments = _seed_departments(db)
        _seed_offers(db, departments)
        _seed_candidates(db)
        db.commit()
        logger.info("Database seeding complete")
    except Exception:  # pragma: no cover
        db.rollback()
        logger.exception("Seeding failed")
        raise
