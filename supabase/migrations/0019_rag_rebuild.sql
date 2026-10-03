-- =============================================================================
-- Reconstruction du RAG : base documentaire hybride (plein-texte + vecteurs).
--
-- Remplace entièrement la base documentaire de 0007 → 0018. Les extraits
-- existants sont SUPPRIMÉS : les documents doivent être redéposés, ce qui les
-- redécoupe avec le nouveau découpeur (pages, intertitres) et les vectorise.
--
-- Rejouable : relancer ce fichier sur une base déjà migrée ne casse rien et
-- CONSERVE les documents déjà déposés dans rag_documents / rag_chunks.
--
--   rag_documents   un document déposé : nom unique, type, nombre d'extraits
--   rag_chunks      ses extraits : texte, page, intertitre, tsvector, vecteur
--
-- Recherche : deux classements indépendants — plein-texte (rag_tsquery, déjà
-- en place depuis 0013) et similarité cosinus (pgvector, HNSW) — fusionnés
-- par Reciprocal Rank Fusion. Sans vecteur de requête (pas de clé Mistral, ou
-- API en panne) la recherche reste purement plein-texte, sans rien casser.
--
-- Les planchers de pertinence ne vivent PLUS dans le SQL : l'appelant les
-- passe en paramètres (netlify/functions/_shared/rag/config.ts), une seule
-- source de vérité.
--
-- Enfin, search_candidates cesse de parcourir toute la table (cf. RAG_ANALYSIS
-- #8) : un pré-filtre indexé (GIN plein-texte + trigrammes sur le nom) borne
-- les lignes à classer. Signature et colonnes de retour inchangées.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---- Constructeur de requête : mots vides bilingues ---------------------------
-- 0013 prenait les lexèmes de la question dans les DEUX configurations. Or un
-- mot vide français n'est pas un mot vide anglais : « quelle est la » donnait
-- 'quell' | 'est' | 'la' via la configuration anglaise, et chaque extrait
-- contenant « est » ou « la » ressortait (constaté sur une base réelle). Les
-- mots interrogatifs (« quelle », « combien »…) ne sont des mots vides dans
-- AUCUNE des deux listes de Postgres.
--
-- Un mot n'entre désormais dans la requête que s'il porte du sens dans les
-- deux langues et n'est pas un interrogatif. Les exclusions « -mot » sont
-- conservées.
create or replace function public.rag_tsquery(q text)
returns tsquery
language plpgsql
immutable
parallel safe
as $$
declare
  cleaned   text;
  excluded  text;
  kept      text;
  positives text;
  negatives text;
begin
  q := coalesce(q, '');

  select string_agg(m[1], ' ') into excluded
    from regexp_matches(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', 'g') as m;
  cleaned := regexp_replace(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', ' ', 'g');

  select string_agg(t.w, ' ') into kept
    from regexp_split_to_table(lower(cleaned), '[^[:alnum:]_À-ÿ]+') as t(w)
   where t.w <> ''
     and not (t.w = any (array[
       'quel', 'quelle', 'quels', 'quelles', 'comment', 'combien', 'pourquoi',
       'quand', 'lequel', 'laquelle', 'lesquels', 'lesquelles', 'quoi', 'est-ce',
       'what', 'which', 'how', 'why', 'when', 'who', 'whom', 'whose'
     ]))
     and to_tsvector('french', t.w) <> ''::tsvector
     and to_tsvector('english', t.w) <> ''::tsvector;

  if kept is null then
    return ''::tsquery;
  end if;

  select string_agg(quote_literal(lexeme), ' | ') into positives
    from (
      select lexeme from unnest(to_tsvector('french',  kept))
      union
      select lexeme from unnest(to_tsvector('english', kept))
    ) u;

  if positives is null then
    return ''::tsquery;
  end if;
  if excluded is null then
    return positives::tsquery;
  end if;

  select string_agg('!' || quote_literal(lexeme), ' & ') into negatives
    from (
      select lexeme from unnest(to_tsvector('french',  excluded))
      union
      select lexeme from unnest(to_tsvector('english', excluded))
    ) u;

  if negatives is null then
    return positives::tsquery;
  end if;
  return ('(' || positives || ') & ' || negatives)::tsquery;
end;
$$;

revoke all on function public.rag_tsquery(text) from public, anon, authenticated;
grant execute on function public.rag_tsquery(text) to service_role;

-- ---- Ancienne base documentaire ----------------------------------------------

drop function if exists public.search_document_chunks(text, int, text);
drop function if exists public.replace_document_chunks(text, jsonb, text);
drop function if exists public.list_document_chunk_counts();
drop table if exists public.document_chunks;

-- ---- Tables ------------------------------------------------------------------

create table if not exists public.rag_documents (
  id          bigserial primary key,
  name        text not null unique check (btrim(name) <> ''),
  doc_type    text not null default 'policy' check (doc_type in ('policy', 'cv', 'other')),
  chunk_count int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.rag_chunks (
  id           bigserial primary key,
  document_id  bigint not null references public.rag_documents (id) on delete cascade,
  chunk_index  int  not null,
  content      text not null,
  page         int,
  heading      text,
  -- L'intertitre entre dans le vecteur : « Durée du stage » rend l'extrait
  -- trouvable même si son corps ne répète pas le mot « durée ».
  search_vector tsvector generated always as (
    setweight(to_tsvector('french',  coalesce(heading, '') || ' ' || content), 'A')
    || setweight(to_tsvector('english', coalesce(heading, '') || ' ' || content), 'B')
  ) stored,
  -- mistral-embed : 1024 dimensions. NULL tant que la vectorisation en tâche
  -- de fond n'est pas passée (l'extrait reste trouvable en plein-texte).
  embedding    extensions.vector(1024),
  embedded_at  timestamptz,
  unique (document_id, chunk_index)
);

create index if not exists ix_rag_chunks_document on public.rag_chunks (document_id);
create index if not exists ix_rag_chunks_fts on public.rag_chunks using gin (search_vector);
-- HNSW plutôt qu'ivfflat : aucun entraînement, donc pas d'index dégénéré
-- construit sur une table vide (le défaut de l'ancien index Python).
create index if not exists ix_rag_chunks_embedding on public.rag_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists ix_rag_chunks_pending on public.rag_chunks (id) where embedding is null;

alter table public.rag_documents enable row level security;
alter table public.rag_chunks enable row level security;

-- ---- Ingestion atomique ------------------------------------------------------
-- Vérification d'existence ET remplacement dans la même transaction : deux
-- dépôts concurrents sous le même nom ne peuvent plus s'écraser (l'un des deux
-- reçoit 23505, que l'API traduit en 409).
create or replace function public.rag_replace_document(
  p_name text,
  p_doc_type text,
  p_chunks jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    bigint;
  v_count int;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'nom de document requis' using errcode = '22023';
  end if;
  if p_doc_type is null or p_doc_type not in ('policy', 'cv', 'other') then
    raise exception 'doc_type invalide: %', p_doc_type using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_chunks, '[]'::jsonb)) <> 'array' then
    raise exception 'p_chunks doit être un tableau JSON' using errcode = '22023';
  end if;

  select d.id into v_id from public.rag_documents d where d.name = p_name for update;

  if v_id is not null then
    if not coalesce(p_replace, false) then
      raise exception 'Un document nommé « % » existe déjà', p_name using errcode = '23505';
    end if;
    delete from public.rag_chunks c where c.document_id = v_id;
    update public.rag_documents d
       set doc_type = p_doc_type, updated_at = now()
     where d.id = v_id;
  else
    -- Course entre deux créations : la contrainte unique tranche (23505).
    insert into public.rag_documents (name, doc_type)
    values (p_name, p_doc_type)
    returning id into v_id;
  end if;

  insert into public.rag_chunks (document_id, chunk_index, content, page, heading)
  select v_id,
         (row_number() over (order by e.ord) - 1)::int,
         e.value ->> 'content',
         nullif(e.value ->> 'page', '')::int,
         nullif(btrim(coalesce(e.value ->> 'heading', '')), '')
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) with ordinality as e(value, ord)
   where btrim(coalesce(e.value ->> 'content', '')) <> '';

  get diagnostics v_count = row_count;
  update public.rag_documents d set chunk_count = v_count where d.id = v_id;

  return jsonb_build_object('document_id', v_id, 'chunks', v_count);
end;
$$;

-- ---- Vectorisation (tâche de fond) -------------------------------------------

create or replace function public.rag_pending_chunks(p_limit int default 64)
returns table (id bigint, content text, heading text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.id, c.content, c.heading
    from public.rag_chunks c
   where c.embedding is null
   order by c.id
   limit greatest(1, least(p_limit, 512));
$$;

-- p_items : [{"id": 12, "embedding": [0.1, ...]}, ...]
create or replace function public.rag_set_embeddings(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.rag_chunks c
     set embedding = (i.value -> 'embedding')::text::extensions.vector,
         embedded_at = now()
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i(value)
   where c.id = (i.value ->> 'id')::bigint;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---- Recherche hybride --------------------------------------------------------
-- fts_rank : ts_rank_cd normalisé (32 = rank/(rank+1)), dans [0, 1[.
-- cosine   : 1 - distance cosinus, NULL si l'extrait n'a pas été retenu par la
--            branche vectorielle.
-- score    : RRF, sert uniquement à ORDONNER — jamais affiché.
create or replace function public.rag_search_chunks(
  q text,
  q_embedding extensions.vector(1024) default null,
  match_count int default 15,
  p_doc_type text default null,
  p_min_fts real default 0,
  p_min_cosine real default 0,
  p_rrf_k int default 60
)
returns table (
  chunk_id bigint,
  source_document text,
  doc_type text,
  chunk_index int,
  page int,
  heading text,
  content text,
  fts_rank real,
  cosine real,
  score real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with params as (
    select greatest(1, least(coalesce(match_count, 15), 60)) as n
  ),
  query as (
    select public.rag_tsquery(q) as tsq
  ),
  fts as (
    select c.id,
           ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32)::real as rank
      from public.rag_chunks c
      join public.rag_documents d on d.id = c.document_id
     cross join query
     where query.tsq <> ''::tsquery
       and c.search_vector @@ query.tsq
       and (p_doc_type is null or d.doc_type = p_doc_type)
     order by rank desc, c.id
     limit (select n from params)
  ),
  fts_ranked as (
    select f.id, f.rank, row_number() over (order by f.rank desc, f.id) as pos
      from fts f
     where f.rank >= coalesce(p_min_fts, 0)
  ),
  vec as (
    select c.id, (1 - (c.embedding <=> q_embedding))::real as cos
      from public.rag_chunks c
      join public.rag_documents d on d.id = c.document_id
     where q_embedding is not null
       and c.embedding is not null
       and (p_doc_type is null or d.doc_type = p_doc_type)
     order by c.embedding <=> q_embedding, c.id
     limit (select n from params)
  ),
  vec_ranked as (
    select v.id, v.cos, row_number() over (order by v.cos desc, v.id) as pos
      from vec v
     where v.cos >= coalesce(p_min_cosine, 0)
  ),
  merged as (
    select coalesce(f.id, v.id) as id,
           f.rank,
           v.cos,
           coalesce(1.0 / (p_rrf_k + f.pos), 0) + coalesce(1.0 / (p_rrf_k + v.pos), 0) as score
      from fts_ranked f
      full outer join vec_ranked v on v.id = f.id
  )
  select c.id, d.name, d.doc_type, c.chunk_index, c.page, c.heading, c.content,
         coalesce(m.rank, 0)::real, m.cos, m.score::real
    from merged m
    join public.rag_chunks c on c.id = m.id
    join public.rag_documents d on d.id = c.document_id
   order by m.score desc, c.id
   limit (select n from params);
$$;

-- ---- Gestion de la base documentaire ------------------------------------------

create or replace function public.rag_list_documents()
returns table (source_document text, chunks bigint, doc_type text, embedded bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.name,
         count(c.id),
         d.doc_type,
         count(c.embedding)
    from public.rag_documents d
    left join public.rag_chunks c on c.document_id = d.id
   group by d.id
   order by d.doc_type, d.name;
$$;

create or replace function public.rag_delete_document(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  -- Les extraits suivent par ON DELETE CASCADE.
  delete from public.rag_documents d where d.name = p_name;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ---- Recherche de candidats : pré-filtre indexé ------------------------------
-- 0017 calculait ts_rank_cd ET word_similarity pour CHAQUE candidat. Ici, seuls
-- les candidats retenus par un index entrent dans le calcul :
--   • plein-texte : search_vector @@ tsq (GIN ix_candidates_fts) ;
--   • nom approché : pour chaque mot de la question (≥ 3 lettres), `mot <% nom`
--     — forme indexable par le GIN trigramme ci-dessous ;
--   • recherche purement structurée (« tous les Bac+5 ») : seul cas sans index.
-- Le score final et ses planchers sont ceux de 0017, à l'identique.
--
-- Une correction de plus : 0017 retirait les particules (El, Ben, Aït…) du NOM
-- indexé, mais pas de la QUESTION. Or le texte du CV (poids C) contient le nom
-- complet : « Babtich El Habib » matchait encore « Youssef El Khattabi » par le
-- seul lexème 'el'. La requête plein-texte est donc construite sur le noyau de
-- la question, particules retirées (rag_name_core).
create index if not exists ix_candidates_name_core_trgm
  on public.candidates
  using gin (public.rag_name_core(first_name || ' ' || last_name) gin_trgm_ops);

create or replace function public.search_candidates(
  q text,
  min_years numeric default null,
  education text default null,
  top_k int default 5
)
returns table (
  candidate_id bigint,
  name text,
  education_level text,
  field_of_study text,
  years_experience numeric,
  skills text[],
  rank real,
  name_similarity real
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (select 0.72::real as name_match_min, 0.06::real as relevance_min),
  query as (
    select public.rag_tsquery(public.rag_name_core(q)) as tsq,
           public.rag_name_core(coalesce(q, '')) as qcore
  ),
  tokens as (
    select distinct t.word
      from query,
           regexp_split_to_table(query.qcore, '[^[:alnum:]À-ÿ''-]+') as t(word)
     where length(t.word) >= 3
  ),
  pool as (
    select c.id
      from public.candidates c, query
     where query.tsq <> ''::tsquery
       and c.search_vector @@ query.tsq
    union
    select c.id
      from tokens
      join public.candidates c
        on tokens.word <% public.rag_name_core(c.first_name || ' ' || c.last_name)
    union
    select c.id
      from public.candidates c, query
     where query.tsq = ''::tsquery
       and (min_years is not null or education is not null)
  ),
  scored as (
    select
      c.id,
      trim(c.first_name || ' ' || c.last_name) as full_name,
      c.education_level,
      c.field_of_study,
      c.years_experience,
      ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32)::real
        as text_rank,
      word_similarity(
        public.rag_name_core(c.first_name || ' ' || c.last_name),
        query.qcore
      )::real as name_sim
    from pool
    join public.candidates c on c.id = pool.id
    cross join query
    where (min_years is null or c.years_experience >= min_years)
      and (education is null
           or c.education_level ilike '%' || public.rag_like_escape(education) || '%')
  )
  select
    s.id,
    s.full_name,
    s.education_level,
    s.field_of_study,
    s.years_experience,
    coalesce(
      (select array_agg(sk.name order by sk.name)
         from public.candidate_skills cs
         join public.skills sk on sk.id = cs.skill_id
        where cs.candidate_id = s.id),
      '{}'::text[]
    ),
    greatest(
      s.text_rank,
      case when s.name_sim >= p.name_match_min then s.name_sim else 0::real end
    ),
    s.name_sim
  from scored s, params p, query
  where
    (query.tsq = ''::tsquery and (min_years is not null or education is not null))
    or greatest(
         s.text_rank,
         case when s.name_sim >= p.name_match_min then s.name_sim else 0::real end
       ) >= p.relevance_min
  order by 7 desc, s.id
  limit greatest(1, least(top_k, 20));
$$;

-- Le diagnostic d'une recherche vide doit compter avec la MÊME requête.
create or replace function public.search_candidates_diag(
  q text,
  min_years numeric default null,
  education text default null
)
returns table (
  scanned bigint,
  term_matches bigint,
  excluded_by_years bigint,
  excluded_by_education bigint,
  experience_unknown bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select public.rag_tsquery(public.rag_name_core(q)) as tsq,
           public.rag_name_core(coalesce(q, '')) as qcore
  ),
  matched as (
    select c.*
    from public.candidates c, query
    where query.tsq = ''::tsquery
       or ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32) >= 0.06
       or word_similarity(
            public.rag_name_core(c.first_name || ' ' || c.last_name),
            query.qcore
          ) >= 0.72
  )
  select
    (select count(*) from public.candidates)                        as scanned,
    (select count(*) from matched)                                  as term_matches,
    (select count(*) from matched m
      where min_years is not null and m.years_experience < min_years) as excluded_by_years,
    (select count(*) from matched m
      where education is not null
        and (m.education_level is null
             or m.education_level not ilike '%' || public.rag_like_escape(education) || '%'))
                                                                    as excluded_by_education,
    (select count(*) from matched m
      where min_years is not null and m.years_experience = 0)       as experience_unknown;
$$;

-- ---- Droits ------------------------------------------------------------------
-- Les fonctions serverless imposent elles-mêmes l'auth staff : seul le rôle de
-- service exécute ces fonctions.

revoke all on function public.rag_replace_document(text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.rag_pending_chunks(int) from public, anon, authenticated;
revoke all on function public.rag_set_embeddings(jsonb) from public, anon, authenticated;
revoke all on function public.rag_search_chunks(text, extensions.vector, int, text, real, real, int) from public, anon, authenticated;
revoke all on function public.rag_list_documents() from public, anon, authenticated;
revoke all on function public.rag_delete_document(text) from public, anon, authenticated;
revoke all on function public.search_candidates(text, numeric, text, int) from public, anon, authenticated;
revoke all on function public.search_candidates_diag(text, numeric, text) from public, anon, authenticated;

grant execute on function public.rag_replace_document(text, text, jsonb, boolean) to service_role;
grant execute on function public.rag_pending_chunks(int) to service_role;
grant execute on function public.rag_set_embeddings(jsonb) to service_role;
grant execute on function public.rag_search_chunks(text, extensions.vector, int, text, real, real, int) to service_role;
grant execute on function public.rag_list_documents() to service_role;
grant execute on function public.rag_delete_document(text) to service_role;
grant execute on function public.search_candidates(text, numeric, text, int) to service_role;
grant execute on function public.search_candidates_diag(text, numeric, text) to service_role;

grant select, insert, update, delete on public.rag_documents, public.rag_chunks to service_role;
grant usage, select on sequence public.rag_documents_id_seq, public.rag_chunks_id_seq to service_role;
