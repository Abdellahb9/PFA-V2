"""Add indexes on foreign-key columns (Supabase performance advisor).

PostgreSQL does not auto-create an index for a foreign key. Unindexed FKs slow
down joins and force sequential scans during ON DELETE CASCADE / SET NULL.
Supabase's performance advisor flags these as ``unindexed_foreign_keys``.

We add an index on every FK column not already covered by a PK / unique /
existing index. Index names follow SQLAlchemy's ``ix_<table>_<column>``
convention so the ORM models (index=True) stay in sync with the database.

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-16
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

# (index_name, table, column) for FK columns lacking a covering index.
_INDEXES = [
    ("ix_applications_candidate_id", "applications", "candidate_id"),
    ("ix_applications_offer_id", "applications", "offer_id"),
    ("ix_assignments_candidate_id", "assignments", "candidate_id"),
    ("ix_assignments_offer_id", "assignments", "offer_id"),
    ("ix_assignments_matching_run_id", "assignments", "matching_run_id"),
    ("ix_candidate_skills_skill_id", "candidate_skills", "skill_id"),
    ("ix_offer_skills_skill_id", "offer_skills", "skill_id"),
    ("ix_documents_application_id", "documents", "application_id"),
    ("ix_internship_offers_department_id", "internship_offers", "department_id"),
    ("ix_notifications_application_id", "notifications", "application_id"),
]


def upgrade() -> None:
    for name, table, column in _INDEXES:
        op.execute(f'CREATE INDEX IF NOT EXISTS {name} ON public."{table}" ("{column}");')


def downgrade() -> None:
    for name, _table, _column in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS public.{name};")
