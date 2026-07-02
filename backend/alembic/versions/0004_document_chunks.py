"""Knowledge-base document chunks for the RAG assistant.

Stores embedded chunks of policy/process documents (internship policy, HR
process guides, ...) queried by the /assistant endpoint. Uses the same
pgvector 384-dim embeddings as candidates / internship_offers.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-02
"""

import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_document", sa.String(length=255), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(EMBEDDING_DIM), nullable=True),
        sa.Column("metadata", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("source_document", "chunk_index", name="uq_chunk_source_index"),
    )
    op.create_index("ix_document_chunks_source_document", "document_chunks", ["source_document"])
    # ANN index for cosine retrieval; lists=100 is fine for tens of thousands of rows.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding "
        "ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);"
    )


def downgrade() -> None:
    op.drop_table("document_chunks")
