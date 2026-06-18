"""Public (unauthenticated) read-only endpoints for the landing page."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.offer import InternshipOffer, OfferStatus
from app.schemas.offer import PublicOfferOut
from app.schemas.skill import SkillRef

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/offers", response_model=list[PublicOfferOut])
def list_public_offers(db: Session = Depends(get_db)):
    """List published (open) internship offers — no authentication required.

    Exposes only non-sensitive fields for the public landing page.
    """
    stmt = (
        select(InternshipOffer)
        .where(InternshipOffer.status == OfferStatus.OPEN)
        .options(
            selectinload(InternshipOffer.required_skills),
            selectinload(InternshipOffer.department),
        )
        .order_by(InternshipOffer.created_at.desc())
    )
    offers = db.scalars(stmt).all()
    return [
        PublicOfferOut(
            id=offer.id,
            title=offer.title,
            field=offer.field,
            slots=offer.slots,
            description=offer.description,
            department_name=offer.department.name if offer.department else None,
            skills=[SkillRef(name=os.skill.name, weight=os.weight) for os in offer.required_skills],
        )
        for offer in offers
    ]
