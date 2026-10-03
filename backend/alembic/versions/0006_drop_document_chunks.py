"""Drop the pgvector knowledge base of the retired Python RAG assistant.

The assistant now lives entirely in the serverless stack (Netlify Functions +
Supabase, see supabase/migrations/0019_rag_rebuild.sql). The Python ``/assistant``
routes, the Celery ingestion task and the ``DocumentChunk`` model are gone, so
the table they wrote to is dropped here. The candidate / offer ivfflat indexes
created by 0005 are unrelated and kept.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-03
"""

import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding;")
    op.execute("DROP TABLE IF EXISTS document_chunks;")


def downgrade() -> None:
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
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding "
        "ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);"
    )
