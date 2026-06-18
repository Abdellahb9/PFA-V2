"""Aggregates all v1 routers under a single APIRouter."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    applications,
    auth,
    candidates,
    dashboard,
    departments,
    matching,
    offers,
    public,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(public.router)
api_router.include_router(departments.router)
api_router.include_router(offers.router)
api_router.include_router(candidates.router)
api_router.include_router(applications.router)
api_router.include_router(matching.router)
api_router.include_router(dashboard.router)
