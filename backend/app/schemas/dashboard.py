"""Dashboard / analytics schemas."""
from __future__ import annotations

from pydantic import BaseModel


class KpiSummary(BaseModel):
    total_candidates: int
    total_applications: int
    total_offers: int
    total_slots: int
    assigned_count: int
    pending_count: int
    assignment_rate: float        # assigned / total applications
    capacity_fill_rate: float     # assigned / total slots
    average_match_score: float


class LabelValue(BaseModel):
    label: str
    value: float


class DepartmentStat(BaseModel):
    department: str
    capacity: int
    assigned: int
    fill_rate: float


class DashboardData(BaseModel):
    kpis: KpiSummary
    applications_by_status: list[LabelValue]
    candidates_by_field: list[LabelValue]
    assignments_by_department: list[DepartmentStat]
    monthly_applications: list[LabelValue]
    top_skills: list[LabelValue]
