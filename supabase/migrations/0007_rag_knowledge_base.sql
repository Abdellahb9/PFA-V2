-- =============================================================================
-- RAG knowledge base for the serverless assistant (/api/assistant/*).
--
-- The serverless stack has no embedding model (Groq only), so retrieval uses
-- Postgres full-text search (french config) over chunked policy documents,
-- mirroring the pgvector-based backend feature. Chunks are written/read by the
-- functions with the SERVICE ROLE key; RLS is enabled with no anon policies.
-- =============================================================================

create table if not exists public.document_chunks (
  id bigserial primary key,
  source_document text not null,
  chunk_text text not null,
  chunk_index int not null,
  metadata jsonb,
  -- French-configured search vector kept in sync automatically.
  search_vector tsvector generated always as (
    to_tsvector('french', coalesce(chunk_text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (source_document, chunk_index)
);

create index if not exists ix_document_chunks_source
  on public.document_chunks (source_document);
create index if not exists ix_document_chunks_fts
  on public.document_chunks using gin (search_vector);

alter table public.document_chunks enable row level security;

-- Ranked full-text retrieval; `websearch_to_tsquery` tolerates natural phrasing.
create or replace function public.search_document_chunks(q text, top_k int default 5)
returns table (
  source_document text,
  chunk_index int,
  chunk_text text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select c.source_document, c.chunk_index, c.chunk_text,
         ts_rank(c.search_vector, websearch_to_tsquery('french', q)) as rank
  from public.document_chunks c
  where c.search_vector @@ websearch_to_tsquery('french', q)
  order by rank desc
  limit greatest(1, least(top_k, 20));
$$;

-- Service-role only (functions enforce staff auth themselves).
revoke all on function public.search_document_chunks(text, int) from public, anon, authenticated;
