"""Department CRUD endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_staff
from app.core.database import get_db
from app.models.department import Department
from app.models.offer import InternshipOffer
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Department).order_by(Department.name)).all()


@router.post("", response_model=DepartmentOut, status_code=201)
def create_department(
    body: DepartmentCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    if db.scalar(select(Department).where(Department.code == body.code)):
        raise HTTPException(status_code=409, detail="Code de département déjà existant")
    dept = Department(**body.model_dump())
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.get("/{department_id}", response_model=DepartmentOut)
def get_department(
    department_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Département introuvable")
    return dept


@router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    body: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Département introuvable")
    data = body.model_dump(exclude_unset=True)
    # Conflict check: the code is unique across departments.
    new_code = data.get("code")
    if new_code and new_code != dept.code:
        clash = db.scalar(
            select(Department).where(Department.code == new_code, Department.id != department_id)
        )
        if clash:
            raise HTTPException(status_code=409, detail="Code de département déjà existant")
    for key, value in data.items():
        setattr(dept, key, value)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete("/{department_id}", status_code=204)
def delete_department(
    department_id: int, db: Session = Depends(get_db), _: User = Depends(require_staff)
):
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Département introuvable")
    # Referential integrity: block deletion while offers are still attached.
    offer_count = db.scalar(
        select(func.count(InternshipOffer.id)).where(InternshipOffer.department_id == department_id)
    )
    if offer_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Impossible de supprimer : {offer_count} offre(s) rattachée(s). "
                "Supprimez d'abord ces offres."
            ),
        )
    db.delete(dept)
    db.commit()
