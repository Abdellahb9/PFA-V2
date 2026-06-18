"""FastAPI application entrypoint - Assistant IA PHOSBOUCRAA."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Seed reference data on startup (admin user, demo departments/offers)."""
    try:
        from app.crud.seed import seed_all

        db = SessionLocal()
        try:
            seed_all(db)
        finally:
            db.close()
    except Exception as exc:  # pragma: no cover - non-fatal in dev
        logger.warning("Startup seeding skipped: %s", exc)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    description=(
        "API de l'Assistant IA pour la gestion des demandes de stage "
        "et l'affectation intelligente des stagiaires - OCP PHOSBOUCRAA."
    ),
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok", "service": settings.PROJECT_NAME}
