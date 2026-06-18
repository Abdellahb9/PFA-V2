"""Dashboard analytics endpoint: KPIs + chart series for the admin UI."""
from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.application import Application, ApplicationStatus
from app.models.assignment import Assignment, AssignmentStatus
from app.models.candidate import Candidate, CandidateSkill
from app.models.department import Department
from app.models.offer import InternshipOffer
from app.models.skill import Skill
from app.models.user import User
from app.schemas.dashboard import (
    DashboardData,
    DepartmentStat,
    KpiSummary,
    LabelValue,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Human-readable French labels for application statuses (UI in French).
_STATUS_LABELS_FR: dict[str, str] = {
    "submitted": "Soumise",
    "parsing": "Analyse en cours",
    "parsed": "Analysée",
    "under_review": "En revue",
    "assigned": "Affectée",
    "rejected": "Rejetée",
    "failed": "Échec",
}


@router.get("", response_model=DashboardData)
def get_dashboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Aggregate KPIs and chart-ready series in a single payload."""
    total_candidates = db.scalar(select(func.count(Candidate.id))) or 0
    total_applications = db.scalar(select(func.count(Application.id))) or 0
    total_offers = db.scalar(select(func.count(InternshipOffer.id))) or 0
    total_slots = db.scalar(select(func.coalesce(func.sum(InternshipOffer.slots), 0))) or 0

    assigned_count = db.scalar(
        select(func.count(Application.id)).where(
            Application.status == ApplicationStatus.ASSIGNED
        )
    ) or 0
    pending_count = db.scalar(
        select(func.count(Application.id)).where(
            Application.status.in_(
                [ApplicationStatus.SUBMITTED, ApplicationStatus.PARSED,
                 ApplicationStatus.UNDER_REVIEW]
            )
        )
    ) or 0
    avg_score = db.scalar(
        select(func.coalesce(func.avg(Assignment.match_score), 0.0)).where(
            Assignment.status != AssignmentStatus.REJECTED
        )
    ) or 0.0

    kpis = KpiSummary(
        total_candidates=total_candidates,
        total_applications=total_applications,
        total_offers=total_offers,
        total_slots=int(total_slots),
        assigned_count=assigned_count,
        pending_count=pending_count,
        assignment_rate=round(assigned_count / total_applications, 3) if total_applications else 0.0,
        capacity_fill_rate=round(assigned_count / total_slots, 3) if total_slots else 0.0,
        average_match_score=round(float(avg_score), 3),
    )

    # --- Applications by status ---
    status_rows = db.execute(
        select(Application.status, func.count(Application.id)).group_by(Application.status)
    ).all()
    applications_by_status = [
        LabelValue(label=_STATUS_LABELS_FR.get(s.value, s.value), value=c)
        for s, c in status_rows
    ]

    # --- Candidates by field of study ---
    field_rows = db.execute(
        select(
            func.coalesce(Candidate.field_of_study, "Non renseigné"),
            func.count(Candidate.id),
        )
        .group_by(Candidate.field_of_study)
        .order_by(func.count(Candidate.id).desc())
        .limit(8)
    ).all()
    candidates_by_field = [LabelValue(label=f, value=c) for f, c in field_rows]

    # --- Assignments by department (with fill rate) ---
    dept_rows = db.execute(
        select(
            Department.name,
            Department.capacity,
            func.count(Assignment.id),
        )
        .select_from(Department)
        .join(InternshipOffer, InternshipOffer.department_id == Department.id, isouter=True)
        .join(
            Assignment,
            (Assignment.offer_id == InternshipOffer.id)
            & (Assignment.status != AssignmentStatus.REJECTED),
            isouter=True,
        )
        .group_by(Department.id)
        .order_by(Department.name)
    ).all()
    assignments_by_department = [
        DepartmentStat(
            department=name,
            capacity=capacity,
            assigned=assigned,
            fill_rate=round(assigned / capacity, 3) if capacity else 0.0,
        )
        for name, capacity, assigned in dept_rows
    ]

    # --- Monthly applications ---
    # Group/order by output position (1) so the to_char expression isn't bound
    # twice with distinct parameters (which Postgres rejects in GROUP BY).
    month_rows = db.execute(
        select(
            func.to_char(Application.created_at, "YYYY-MM").label("month"),
            func.count(Application.id),
        )
        .group_by(text("1"))
        .order_by(text("1"))
    ).all()
    monthly_applications = [LabelValue(label=m, value=c) for m, c in month_rows]

    # --- Top skills across candidates ---
    skill_rows = db.execute(
        select(Skill.name, func.count(CandidateSkill.id))
        .join(CandidateSkill, CandidateSkill.skill_id == Skill.id)
        .group_by(Skill.id)
        .order_by(func.count(CandidateSkill.id).desc())
        .limit(10)
    ).all()
    top_skills = [LabelValue(label=n, value=c) for n, c in skill_rows]

    return DashboardData(
        kpis=kpis,
        applications_by_status=applications_by_status,
        candidates_by_field=candidates_by_field,
        assignments_by_department=assignments_by_department,
        monthly_applications=monthly_applications,
        top_skills=top_skills,
    )
