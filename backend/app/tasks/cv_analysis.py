"""Celery task: parse an application's documents and build the candidate profile."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.crud.skill import get_or_create_skill
from app.models.application import Application, ApplicationStatus
from app.models.candidate import CandidateSkill
from app.services.matching.service import compute_application_best_score
from app.services.nlp.parser import extract_text
from app.services.nlp.pipeline import parse_cv
from app.services.storage import download_document

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.cv_analysis.analyze_application", bind=True, max_retries=2)
def analyze_application(self, application_id: int) -> dict:
    """Extract text from the CV, run NLP profiling and enrich the candidate.

    Pipeline: download docs -> extract text -> parse profile -> persist skills,
    education metadata and the semantic embedding -> set status to PARSED.
    """
    db = SessionLocal()
    try:
        app = db.get(Application, application_id)
        if app is None:
            logger.warning("Application %s not found", application_id)
            return {"status": "not_found"}

        app.status = ApplicationStatus.PARSING
        db.commit()

        # 1) Gather text from all attached documents (CV first).
        full_text_parts: list[str] = []
        for doc in app.documents:
            try:
                data = download_document(doc.object_key)
                text = extract_text(data, doc.filename, doc.content_type)
                doc.extracted_text = text
                full_text_parts.append(text)
            except Exception as exc:  # pragma: no cover - storage failure
                logger.exception("Failed to read document %s: %s", doc.id, exc)
        full_text = "\n".join(full_text_parts)

        if not full_text.strip():
            app.status = ApplicationStatus.FAILED
            db.commit()
            return {"status": "no_text"}

        # 2) NLP profiling.
        profile = parse_cv(full_text)

        # 3) Enrich the candidate with extracted metadata.
        cand = app.candidate
        cand.cv_text = full_text[:20000]
        cand.education_level = profile.education_level or cand.education_level
        cand.field_of_study = profile.field_of_study or cand.field_of_study
        cand.university = profile.university or cand.university
        cand.years_experience = profile.years_experience or cand.years_experience
        if profile.embedding:
            cand.embedding = profile.embedding

        # 4) Replace skills with the freshly detected set.
        cand.skills.clear()
        db.flush()
        for skill_name, weight in profile.skills.items():
            skill = get_or_create_skill(db, skill_name)
            cand.skills.append(CandidateSkill(skill_id=skill.id, weight=weight))

        # 5) Mark ready for matching.
        app.status = ApplicationStatus.PARSED
        app.parsed_at = datetime.now(UTC)
        db.commit()

        # 6) Compute an indicative best-fit score across open offers.
        compute_application_best_score(db, application_id)

        return {
            "status": "parsed",
            "application_id": application_id,
            "skills": list(profile.skills.keys()),
            "education_level": profile.education_level,
        }
    except Exception as exc:  # pragma: no cover - retry on transient errors
        db.rollback()
        logger.exception("CV analysis failed for %s", application_id)
        raise self.retry(exc=exc, countdown=10) from exc
    finally:
        db.close()
