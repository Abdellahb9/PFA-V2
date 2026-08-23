"""ANN indexes for the candidate / offer embeddings.

0004 created an ivfflat index for ``document_chunks`` only, so every semantic
search over ``candidates`` and ``internship_offers`` computed the cosine
distance for EVERY row — a sequential scan on each assistant query.

The ``document_chunks`` index has its own problem: it was built at migration
time, on an empty table. ivfflat derives its cluster lists from the data present
when the index is created, so an index built on zero rows is degenerate and must
be rebuilt once the corpus is loaded. Same reason the two indexes below are
created here but need a REINDEX after the first bulk import — see the note at
the bottom of this file.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-23
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# lists ~ sqrt(rows) est la règle usuelle ; 100 convient jusqu'à ~100k profils.
_LISTS = 100


def upgrade() -> None:
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_candidates_embedding "
        f"ON candidates USING ivfflat (embedding vector_cosine_ops) WITH (lists = {_LISTS});"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_offers_embedding "
        f"ON internship_offers USING ivfflat (embedding vector_cosine_ops) WITH (lists = {_LISTS});"
    )
    # ivfflat.probes = 1 (défaut) n'explore qu'une liste : rapide mais le rappel
    # s'effondre. 10 sondes est le compromis habituel pour lists = 100.
    op.execute("ALTER DATABASE CURRENT SET ivfflat.probes = 10;")


def downgrade() -> None:
    op.execute("ALTER DATABASE CURRENT RESET ivfflat.probes;")
    op.execute("DROP INDEX IF EXISTS ix_offers_embedding;")
    op.execute("DROP INDEX IF EXISTS ix_candidates_embedding;")


# APRÈS le premier import massif de CV / offres / documents, reconstruire les
# trois index pour que leurs listes reflètent les données réelles :
#
#   REINDEX INDEX ix_candidates_embedding;
#   REINDEX INDEX ix_offers_embedding;
#   REINDEX INDEX ix_document_chunks_embedding;
