-- =============================================================================
-- Séparer la politique de stage des CV dans la base documentaire.
--
-- Le panneau s'intitule « Base documentaire (politique de stage) », mais rien
-- n'empêchait d'y déposer un CV : `document_chunks` n'a qu'un `source_document`
-- libre. Conséquence observée — une question sur la politique de stage pouvait
-- remonter des extraits de babtich-el-habib-cv.pdf, et inversement.
--
-- Une table distincte serait excessive : même forme, même indexation, même
-- recherche. On qualifie donc les extraits, et la recherche filtre.
--
--   policy  règlement, convention, charte, procédure — la doctrine
--   cv      un CV déposé, qui parle d'UNE personne
--   other   tout le reste
-- =============================================================================

alter table public.document_chunks
  add column if not exists doc_type text not null default 'policy';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_chunks_doc_type_check'
  ) then
    alter table public.document_chunks
      add constraint document_chunks_doc_type_check
      check (doc_type in ('policy', 'cv', 'other'));
  end if;
end $$;

create index if not exists ix_document_chunks_doc_type
  on public.document_chunks (doc_type);

-- Reprise de l'existant : le nom du fichier est le seul indice disponible.
-- Tout ce qui ressemble à un CV est requalifié ; le reste garde « policy ».
update public.document_chunks
   set doc_type = 'cv'
 where doc_type = 'policy'
   and (source_document ~* '(^|[^a-z])cv([^a-z]|$)'
        or source_document ~* 'resume|curriculum');

-- ---- Anciennes signatures retirées AVANT toute recréation --------------------
--
-- `create or replace` ne peut PAS changer le type de retour d'une fonction :
-- PostgreSQL répond « 42P13 cannot change return type of existing function ».
-- list_document_chunk_counts() garde sa signature (aucun argument) mais gagne
-- une colonne doc_type : il faut donc la supprimer d'abord.
--
-- Les deux autres changent de SIGNATURE (un argument de plus), donc un simple
-- `create or replace` créerait une SURCHARGE au lieu de remplacer. On retire
-- l'ancienne version : deux variantes coexistantes rendraient l'appel à deux
-- arguments ambigu, et laisseraient un appelant écrire des extraits sans type.
drop function if exists public.replace_document_chunks(text, jsonb);
drop function if exists public.search_document_chunks(text, int);
drop function if exists public.list_document_chunk_counts();

-- ---- Recherche filtrée -------------------------------------------------------
-- `p_doc_type` à NULL = tous les types (comportement historique).
create or replace function public.search_document_chunks(
  q text,
  top_k int default 5,
  p_doc_type text default null
)
returns table (
  source_document text,
  chunk_index int,
  chunk_text text,
  rank real,
  doc_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (select public.rag_tsquery(q) as tsq)
  select c.source_document, c.chunk_index, c.chunk_text,
         ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32) as rank,
         c.doc_type
  from public.document_chunks c, query
  where query.tsq != ''::tsquery
    and c.search_vector @@ query.tsq
    and (p_doc_type is null or c.doc_type = p_doc_type)
  order by rank desc, c.source_document, c.chunk_index
  limit greatest(1, least(top_k, 20));
$$;

-- Le comptage affiché dans le panneau expose aussi le type.
create or replace function public.list_document_chunk_counts()
returns table (source_document text, chunks bigint, doc_type text)
language sql
stable
security definer
set search_path = public
as $$
  select c.source_document, count(*) as chunks, min(c.doc_type) as doc_type
  from public.document_chunks c
  group by c.source_document
  order by min(c.doc_type), c.source_document;
$$;

-- L'ingestion porte désormais le type du document remplacé.
create or replace function public.replace_document_chunks(
  p_source_document text,
  p_chunks jsonb,
  p_doc_type text default 'policy'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  if p_source_document is null or btrim(p_source_document) = '' then
    raise exception 'source_document requis';
  end if;
  if p_doc_type not in ('policy', 'cv', 'other') then
    raise exception 'doc_type invalide: %', p_doc_type;
  end if;

  delete from public.document_chunks where source_document = p_source_document;

  insert into public.document_chunks (source_document, chunk_text, chunk_index, doc_type)
  select p_source_document, chunk.value, (chunk.ordinality - 1)::int, p_doc_type
    from jsonb_array_elements_text(coalesce(p_chunks, '[]'::jsonb))
         with ordinality as chunk(value, ordinality)
   where btrim(chunk.value) <> '';

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.search_document_chunks(text, int, text)
  from public, anon, authenticated;
revoke all on function public.list_document_chunk_counts() from public, anon, authenticated;
revoke all on function public.replace_document_chunks(text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.search_document_chunks(text, int, text) to service_role;
grant execute on function public.list_document_chunk_counts() to service_role;
grant execute on function public.replace_document_chunks(text, jsonb, text) to service_role;
