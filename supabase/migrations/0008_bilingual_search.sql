-- =============================================================================
-- Bilingual (French + English) full-text retrieval for the RAG assistant.
--
-- 0007 indexed chunks with the french config only, so English policy documents
-- and English queries missed stemming ("internships" never matched "internship").
-- The search vector now concatenates both configs and the RPC ORs both parsed
-- queries, so any FR/EN query matches any FR/EN document.
-- =============================================================================

alter table public.document_chunks drop column if exists search_vector;
alter table public.document_chunks add column search_vector tsvector
  generated always as (
    to_tsvector('french', coalesce(chunk_text, ''))
    || to_tsvector('english', coalesce(chunk_text, ''))
  ) stored;

create index if not exists ix_document_chunks_fts
  on public.document_chunks using gin (search_vector);

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
  with query as (
    select websearch_to_tsquery('french', q)
        || websearch_to_tsquery('english', q) as tsq
  )
  select c.source_document, c.chunk_index, c.chunk_text,
         ts_rank(c.search_vector, query.tsq) as rank
  from public.document_chunks c, query
  where c.search_vector @@ query.tsq
  order by rank desc
  limit greatest(1, least(top_k, 20));
$$;

revoke all on function public.search_document_chunks(text, int) from public, anon, authenticated;
