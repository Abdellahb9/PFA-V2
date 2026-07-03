"""Shared pytest fixtures: ephemeral in-memory database + FastAPI test client.

Integration tests exercise the real FastAPI app over HTTP (httpx-backed
``TestClient``) against an **ephemeral SQLite database** created per test, so
no PostgreSQL instance is required. PostgreSQL-only column types are mapped to
SQLite equivalents at DDL-compile time. The client is used without a context
manager on purpose: the lifespan (startup seeding) never runs, tests fully
control their data. Endpoints relying on pgvector similarity are out of scope.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User, UserRole


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw) -> str:
    """Render PostgreSQL JSONB as plain JSON on the SQLite test database."""
    return "JSON"


@pytest.fixture()
def db_engine():
    """Fresh in-memory SQLite database with the full ORM schema."""
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    """Direct ORM session for arranging test data (commit before HTTP calls)."""
    factory = sessionmaker(bind=db_engine, autoflush=False, future=True)
    session = factory()
    yield session
    session.close()


@pytest.fixture()
def client(db_engine):
    """HTTP client wired to the ephemeral database via dependency override."""
    factory = sessionmaker(bind=db_engine, autoflush=False, future=True)

    def _override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


ADMIN_PASSWORD = "S3cure!AdminPass"
VIEWER_PASSWORD = "S3cure!ViewerPass"


def _create_user(db: Session, email: str, password: str, role: UserRole) -> User:
    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name="Test User",
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def admin_user(db_session):
    return _create_user(db_session, "admin@test-pfa.ma", ADMIN_PASSWORD, UserRole.ADMIN)


@pytest.fixture()
def viewer_user(db_session):
    return _create_user(db_session, "viewer@test-pfa.ma", VIEWER_PASSWORD, UserRole.VIEWER)


def login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    """Perform a real login and return the Authorization header."""
    resp = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture()
def admin_headers(client, admin_user):
    return login_headers(client, admin_user.email, ADMIN_PASSWORD)
