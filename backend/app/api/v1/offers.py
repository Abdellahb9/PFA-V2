"""Internship offer endpoints (CRUD + required skills + embedding)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_staff
from app.core.database import get_db
from app.crud.skill import get_or_create_skill
from app.models.application import Application
from app.models.department import Department
from app.models.offer import InternshipOffer, OfferSkill
from app.models.user import User
from app.schemas.offer import OfferCreate, OfferOut, OfferUpdate
from app.schemas.skill import SkillRef
from app.services.nlp.embeddings import embed_text
from app.services.nlp.pipeline import build_offer_text

router = APIRouter(prefix="/offers", tags=["offers"])


def _serialize(offer: InternshipOffer) -> OfferOut:
    """Convert an ORM offer into its API representation (with skill refs)."""
    data = OfferOut.model_validate(offer)
    data.skills = [SkillRef(name=os.skill.name, weight=os.weight) for os in offer.required_skills]
    return data


def _apply_skills(db: Session, offer: InternshipOffer, skills: list[SkillRef]) -> None:
    """Replace an offer's required skills and refresh its semantic embedding."""
    offer.required_skills.clear()
    db.flush()
    skill_names: list[str] = []
    for ref in skills:
        skill = get_or_create_skill(db, ref.name)
        offer.required_skills.append(OfferSkill(skill_id=skill.id, weight=ref.weight))
        skill_names.append(ref.name)
    # Embed a composite of title/description/field/skills for semantic matching.
    text = build_offer_text(offer.title, offer.description, offer.field, skill_names)
    offer.embedding = embed_text(text)


@router.get("", response_model=list[OfferOut])
def list_offers(
    department_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(InternshipOffer)
        .options(selectinload(InternshipOffer.required_skills))
        .order_by(InternshipOffer.created_at.desc())
    )
    if department_id:
        stmt = stmt.where(InternshipOffer.department_id == department_id)
    return [_serialize(o) for o in db.scalars(stmt).all()]


@router.post("", response_model=OfferOut, status_code=201)
def create_offer(
    body: OfferCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    if not db.get(Department, body.department_id):
        raise HTTPException(status_code=404, detail="Département introuvable")
    payload = body.model_dump(exclude={"skills"})
    offer = InternshipOffer(**payload)
    db.add(offer)
    db.flush()
    _apply_skills(db, offer, body.skills)
    db.commit()
    db.refresh(offer)
    return _serialize(offer)


@router.get("/{offer_id}", response_model=OfferOut)
def get_offer(offer_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    offer = db.get(InternshipOffer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    return _serialize(offer)


@router.patch("/{offer_id}", response_model=OfferOut)
def update_offer(
    offer_id: int,
    body: OfferUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    offer = db.get(InternshipOffer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    data = body.model_dump(exclude_unset=True, exclude={"skills"})
    for key, value in data.items():
        setattr(offer, key, value)
    if body.skills is not None:
        _apply_skills(db, offer, body.skills)
    db.commit()
    db.refresh(offer)
    return _serialize(offer)


@router.delete("/{offer_id}", status_code=204)
def delete_offer(offer_id: int, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    offer = db.get(InternshipOffer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    # Referential integrity: block deletion while applications reference it.
    app_count = db.scalar(
        select(func.count(Application.id)).where(Application.offer_id == offer_id)
    )
    if app_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Impossible de supprimer : {app_count} candidature(s) liée(s) " "à cette offre."
            ),
        )
    db.delete(offer)
    db.commit()
