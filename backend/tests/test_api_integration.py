"""API integration tests: real HTTP requests through the FastAPI app.

Covers the auth flow (login / refresh / me), RBAC guards, the departments CRUD
with its referential-integrity rules, and the public offers endpoint — all
against the ephemeral database provided by ``conftest.py``.
"""

from __future__ import annotations

from app.models.department import Department
from app.models.offer import InternshipOffer, OfferStatus
from tests.conftest import ADMIN_PASSWORD, VIEWER_PASSWORD, login_headers

# ---------------------------------------------------------------------------
# System & auth
# ---------------------------------------------------------------------------


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_login_returns_token_pair(client, admin_user):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": ADMIN_PASSWORD},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]


def test_login_wrong_password_is_401(client, admin_user):
    resp = client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": "wrong-password"},
    )
    assert resp.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_returns_current_user(client, admin_user, admin_headers):
    resp = client.get("/api/v1/auth/me", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == admin_user.email


def test_refresh_token_mints_new_access_token(client, admin_user):
    login = client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": ADMIN_PASSWORD},
    ).json()
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert resp.status_code == 200
    access = resp.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200


def test_refresh_rejects_access_token(client, admin_user):
    login = client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": ADMIN_PASSWORD},
    ).json()
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": login["access_token"]})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Departments CRUD + RBAC + referential integrity
# ---------------------------------------------------------------------------

_DEPT = {"name": "Direction Test", "code": "TEST", "capacity": 3}


def test_departments_require_auth(client):
    assert client.get("/api/v1/departments").status_code == 401
    assert client.post("/api/v1/departments", json=_DEPT).status_code == 401


def test_viewer_cannot_create_department(client, viewer_user):
    headers = login_headers(client, viewer_user.email, VIEWER_PASSWORD)
    resp = client.post("/api/v1/departments", json=_DEPT, headers=headers)
    assert resp.status_code == 403


def test_department_crud_flow(client, admin_headers):
    # Create
    created = client.post("/api/v1/departments", json=_DEPT, headers=admin_headers)
    assert created.status_code == 201
    dept_id = created.json()["id"]

    # Duplicate code is rejected
    dup = client.post("/api/v1/departments", json=_DEPT, headers=admin_headers)
    assert dup.status_code == 409

    # List and get reflect the new department
    listed = client.get("/api/v1/departments", headers=admin_headers)
    assert any(d["id"] == dept_id for d in listed.json())
    fetched = client.get(f"/api/v1/departments/{dept_id}", headers=admin_headers)
    assert fetched.json()["code"] == _DEPT["code"]

    # Update
    patched = client.patch(
        f"/api/v1/departments/{dept_id}",
        json={"name": "Direction Renommée"},
        headers=admin_headers,
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Direction Renommée"

    # Delete, then it is gone
    assert client.delete(f"/api/v1/departments/{dept_id}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/v1/departments/{dept_id}", headers=admin_headers).status_code == 404


def test_department_delete_blocked_while_offers_attached(client, admin_headers, db_session):
    created = client.post("/api/v1/departments", json=_DEPT, headers=admin_headers)
    dept_id = created.json()["id"]

    # Attach an offer directly via the ORM (the POST /offers endpoint computes
    # a semantic embedding, out of scope for these DB-portable tests).
    db_session.add(InternshipOffer(department_id=dept_id, title="Stage Test", slots=1))
    db_session.commit()

    resp = client.delete(f"/api/v1/departments/{dept_id}", headers=admin_headers)
    assert resp.status_code == 409
    assert "offre" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Public endpoints (landing page)
# ---------------------------------------------------------------------------


def test_public_offers_lists_only_open_offers(client, db_session):
    dept = Department(name="DSI Test", code="DSIT", capacity=2)
    db_session.add(dept)
    db_session.flush()
    db_session.add_all(
        [
            InternshipOffer(
                department_id=dept.id,
                title="Offre Ouverte",
                slots=1,
                status=OfferStatus.OPEN,
            ),
            InternshipOffer(
                department_id=dept.id,
                title="Offre Brouillon",
                slots=1,
                status=OfferStatus.DRAFT,
            ),
        ]
    )
    db_session.commit()

    resp = client.get("/api/v1/public/offers")  # no auth required
    assert resp.status_code == 200
    titles = [offer["title"] for offer in resp.json()]
    assert "Offre Ouverte" in titles
    assert "Offre Brouillon" not in titles
    (open_offer,) = [o for o in resp.json() if o["title"] == "Offre Ouverte"]
    assert open_offer["department_name"] == "DSI Test"
