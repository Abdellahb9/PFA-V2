"""Enable Row Level Security on all public tables (Supabase hardening).

Supabase exposes the ``public`` schema through its auto-generated PostgREST API,
reachable with the public ``anon`` key. Without RLS, anyone holding that key
could read/write our tables directly (e.g. dump ``users`` password hashes),
bypassing the FastAPI backend.

Fix: enable RLS on every table and add NO policies (deny-by-default for the
``anon`` / ``authenticated`` PostgREST roles). Our backend connects as the
``postgres`` role, which both OWNS these tables and has BYPASSRLS, so it is
unaffected. RLS is ENABLED (not FORCED) so the owner keeps bypassing it.

On a non-Supabase / plain Postgres deployment this is a harmless no-op-style
hardening (the local app role also owns the tables).

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-16
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# All application tables plus Alembic's bookkeeping table.
_TABLES = [
    "users",
    "skills",
    "departments",
    "candidates",
    "candidate_skills",
    "internship_offers",
    "offer_skills",
    "applications",
    "documents",
    "matching_runs",
    "assignments",
    "notifications",
    "alembic_version",
]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY;')


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY;')
