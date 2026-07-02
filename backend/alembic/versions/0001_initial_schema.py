"""Initial schema - all core tables, enums and pgvector columns.

Revision ID: 0001
Revises:
Create Date: 2026-02-16
"""

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# Embedding dimension must match settings.EMBEDDING_DIM.
EMBED_DIM = 384

_TS = {"server_default": sa.text("now()"), "nullable": False}


def upgrade() -> None:
    # pgvector must exist before creating Vector columns.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "recruiter", "viewer", name="user_role"),
            nullable=False,
            server_default="recruiter",
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # --- skills ---
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("normalized", sa.String(120), nullable=False, unique=True),
        sa.Column(
            "category",
            sa.Enum("technical", "soft", "language", "domain", name="skill_category"),
            nullable=False,
            server_default="technical",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )
    op.create_index("ix_skills_normalized", "skills", ["normalized"])

    # --- departments ---
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("code", sa.String(30), nullable=False, unique=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("supervisor_name", sa.String(150), nullable=True),
        sa.Column("supervisor_email", sa.String(255), nullable=True),
        sa.Column("capacity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )
    op.create_index("ix_departments_code", "departments", ["code"])

    # --- candidates ---
    op.create_table(
        "candidates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("first_name", sa.String(120), nullable=False),
        sa.Column("last_name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("education_level", sa.String(120), nullable=True),
        sa.Column("field_of_study", sa.String(180), nullable=True),
        sa.Column("university", sa.String(200), nullable=True),
        sa.Column("years_experience", sa.Float, nullable=False, server_default="0"),
        sa.Column("cv_text", sa.Text, nullable=True),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )
    op.create_index("ix_candidates_email", "candidates", ["email"])

    # --- candidate_skills ---
    op.create_table(
        "candidate_skills",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "candidate_id",
            sa.Integer,
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id", sa.Integer, sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("weight", sa.Float, nullable=False, server_default="1.0"),
        sa.UniqueConstraint("candidate_id", "skill_id", name="uq_candidate_skill"),
    )

    # --- internship_offers ---
    op.create_table(
        "internship_offers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "department_id",
            sa.Integer,
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("field", sa.String(180), nullable=True),
        sa.Column("slots", sa.Integer, nullable=False, server_default="1"),
        sa.Column("min_education_level", sa.String(120), nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("end_date", sa.Date, nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "closed", "draft", name="offer_status"),
            nullable=False,
            server_default="open",
        ),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )

    # --- offer_skills ---
    op.create_table(
        "offer_skills",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "offer_id",
            sa.Integer,
            sa.ForeignKey("internship_offers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id", sa.Integer, sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("weight", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("required", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("offer_id", "skill_id", name="uq_offer_skill"),
    )

    # --- applications ---
    op.create_table(
        "applications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "candidate_id",
            sa.Integer,
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "offer_id",
            sa.Integer,
            sa.ForeignKey("internship_offers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "submitted",
                "parsing",
                "parsed",
                "under_review",
                "assigned",
                "rejected",
                "failed",
                name="application_status",
            ),
            nullable=False,
            server_default="submitted",
        ),
        sa.Column("motivation", sa.Text, nullable=True),
        sa.Column("match_score", sa.Float, nullable=True),
        sa.Column("parsed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )
    op.create_index("ix_applications_status", "applications", ["status"])

    # --- documents ---
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "application_id",
            sa.Integer,
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "kind",
            sa.Enum("cv", "cover_letter", "transcript", "other", name="document_kind"),
            nullable=False,
            server_default="cv",
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=True),
        sa.Column("size", sa.Integer, nullable=False, server_default="0"),
        sa.Column("extracted_text", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )

    # --- matching_runs ---
    op.create_table(
        "matching_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("algorithm", sa.String(60), nullable=False, server_default="hungarian"),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "completed", "failed", name="matching_run_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("total_candidates", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_slots", sa.Integer, nullable=False, server_default="0"),
        sa.Column("assignments_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("average_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("params", postgresql.JSONB, nullable=True),
        sa.Column("triggered_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )

    # --- assignments ---
    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "application_id",
            sa.Integer,
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "candidate_id",
            sa.Integer,
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "offer_id",
            sa.Integer,
            sa.ForeignKey("internship_offers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "matching_run_id",
            sa.Integer,
            sa.ForeignKey("matching_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("match_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("score_breakdown", postgresql.JSONB, nullable=True),
        sa.Column(
            "status",
            sa.Enum("proposed", "confirmed", "rejected", name="assignment_status"),
            nullable=False,
            server_default="proposed",
        ),
        sa.Column("decided_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
        sa.UniqueConstraint("application_id", name="uq_assignment_application"),
    )

    # --- notifications ---
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("channel", sa.String(40), nullable=False, server_default="email"),
        sa.Column(
            "status",
            sa.Enum("queued", "sent", "failed", name="notification_status"),
            nullable=False,
            server_default="queued",
        ),
        sa.Column(
            "application_id",
            sa.Integer,
            sa.ForeignKey("applications.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
        sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
    )


def downgrade() -> None:
    for table in (
        "notifications",
        "assignments",
        "matching_runs",
        "documents",
        "applications",
        "offer_skills",
        "internship_offers",
        "candidate_skills",
        "candidates",
        "departments",
        "skills",
        "users",
    ):
        op.drop_table(table)
    for enum_name in (
        "notification_status",
        "assignment_status",
        "matching_run_status",
        "document_kind",
        "application_status",
        "offer_status",
        "skill_category",
        "user_role",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
