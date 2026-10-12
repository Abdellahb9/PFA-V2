-- =============================================================================
-- Connaissance par candidat : l'assistant devient un assistant personnel du
-- recruteur, qui connaît chaque candidat, son CV, ses candidatures et leurs
-- résultats, et ce que le recruteur lui a demandé de retenir.
--
-- Avant : les CV des candidatures vivaient dans candidates.cv_text, la base de
-- connaissances de l'assistant (rag_documents) n'était alimentée que par dépôt
-- manuel — les deux ne se rencontraient jamais, et l'assistant, faute d'outil
-- pour compter ou lister, répondait « aucun candidat » avec 7 candidats en base.
--
--   · candidates.profile         profil structuré extrait du CV (résumé,
--                                expériences, formations, projets, langues…)
--   · rag_documents.candidate_id un CV indexé appartient à un candidat
--   · candidate_notes            notes du recruteur (l'assistant peut en écrire
--                                sur demande explicite)
--   · assistant_*                une RPC par lecture de l'assistant : un aller-
--                                retour chacune, testables sur PGlite
--   · rag_search_chunks          filtre par candidat ; la branche vectorielle
--                                sans filtre interroge rag_chunks seule (HNSW)
--
-- Rejouable : toutes les instructions tolèrent d'avoir déjà été appliquées.
-- Toutes les fonctions sont réservées au rôle de service (l'API vérifie
-- elle-même le rôle de l'appelant).
-- =============================================================================

-- ---- Colonnes et tables ---------------------------------------------------------

alter table public.candidates add column if not exists profile jsonb;
alter table public.candidates add column if not exists profile_updated_at timestamptz;

alter table public.rag_documents
  add column if not exists candidate_id bigint references public.candidates (id) on delete cascade;
alter table public.rag_documents add column if not exists title text;
create index if not exists ix_rag_documents_candidate on public.rag_documents (candidate_id);

create table if not exists public.candidate_notes (
  id           bigserial primary key,
  candidate_id bigint not null references public.candidates (id) on delete cascade,
  author_id    uuid,
  author_name  text,
  body         text not null check (btrim(body) <> '' and length(body) <= 2000),
  source       text not null default 'ui' check (source in ('ui', 'assistant')),
  created_at   timestamptz not null default now()
);
create index if not exists ix_candidate_notes_candidate on public.candidate_notes (candidate_id, created_at desc);
alter table public.candidate_notes enable row level security;
grant select, insert, update, delete on public.candidate_notes to service_role;
grant usage, select on sequence public.candidate_notes_id_seq to service_role;

-- ---- Ingestion : un document peut appartenir à un candidat ---------------------
-- La signature change (candidat, titre) : l'ancienne est supprimée, sans quoi
-- PostgREST ne saurait plus quelle surcharge appeler.

drop function if exists public.rag_replace_document(text, text, jsonb, boolean);

create or replace function public.rag_replace_document(
  p_name text,
  p_doc_type text,
  p_chunks jsonb,
  p_replace boolean default false,
  p_candidate_id bigint default null,
  p_title text default null
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
  if p_doc_type is null or p_doc_type not in ('cv', 'other') then
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
       set doc_type = p_doc_type,
           candidate_id = p_candidate_id,
           title = nullif(btrim(coalesce(p_title, '')), ''),
           updated_at = now()
     where d.id = v_id;
  else
    -- Course entre deux créations : la contrainte unique tranche (23505).
    insert into public.rag_documents (name, doc_type, candidate_id, title)
    values (p_name, p_doc_type, p_candidate_id, nullif(btrim(coalesce(p_title, '')), ''))
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

-- ---- Liste des documents : titre et candidat ------------------------------------

drop function if exists public.rag_list_documents();

create or replace function public.rag_list_documents()
returns table (
  source_document text,
  chunks bigint,
  doc_type text,
  embedded bigint,
  title text,
  candidate_id bigint,
  candidate_name text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.name,
         count(c.id),
         d.doc_type,
         count(c.embedding),
         d.title,
         d.candidate_id,
         nullif(trim(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')), '')
    from public.rag_documents d
    left join public.rag_chunks c on c.document_id = d.id
    left join public.candidates k on k.id = d.candidate_id
   group by d.id, k.id
   order by d.doc_type, coalesce(d.title, d.name);
$$;

-- ---- Recherche hybride v3 -----------------------------------------------------------
-- Nouveau : p_candidate_id (chercher dans le CV d'UNE personne), et le titre et
-- le candidat de chaque extrait en sortie.
--
-- Index HNSW : la branche vectorielle sans filtre interroge rag_chunks SEULE,
-- triée par distance — forme que le planificateur sert par l'index (0019
-- joignait rag_documents et ajoutait un tri secondaire, ce qui l'en empêchait).
-- La branche filtrée garde la jointure ; hnsw.iterative_scan (pgvector ≥ 0.8)
-- évite qu'un filtre sélectif ne vide le résultat.

drop function if exists public.rag_search_chunks(text, extensions.vector, int, text, real, real, int);

create or replace function public.rag_search_chunks(
  q text,
  q_embedding extensions.vector(1024) default null,
  match_count int default 15,
  p_doc_type text default null,
  p_min_fts real default 0,
  p_min_cosine real default 0,
  p_rrf_k int default 60,
  p_candidate_id bigint default null
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
  score real,
  title text,
  candidate_id bigint
)
language sql
stable
security definer
set search_path = public, extensions
set hnsw.iterative_scan = 'relaxed_order'
as $$
  with params as (
    select greatest(1, least(coalesce(match_count, 15), 60)) as n,
           (p_doc_type is null and p_candidate_id is null) as unfiltered
  ),
  query as (
    select public.rag_tsquery(q) as tsq
  ),
  scope as (
    select d.id
      from public.rag_documents d
     where (p_doc_type is null or d.doc_type = p_doc_type)
       and (p_candidate_id is null or d.candidate_id = p_candidate_id)
  ),
  fts as (
    select c.id,
           ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32)::real as rank
      from public.rag_chunks c
     cross join query
     where query.tsq <> ''::tsquery
       and c.search_vector @@ query.tsq
       and c.document_id in (select id from scope)
     order by rank desc, c.id
     limit (select n from params)
  ),
  fts_ranked as (
    select f.id, f.rank, row_number() over (order by f.rank desc, f.id) as pos
      from fts f
     where f.rank >= coalesce(p_min_fts, 0)
  ),
  vec_all as (
    select c.id, (1 - (c.embedding <=> q_embedding))::real as cos
      from public.rag_chunks c
     where q_embedding is not null
       and (select unfiltered from params)
     order by c.embedding <=> q_embedding
     limit (select n from params)
  ),
  vec_scoped as (
    select c.id, (1 - (c.embedding <=> q_embedding))::real as cos
      from public.rag_chunks c
     where q_embedding is not null
       and not (select unfiltered from params)
       and c.document_id in (select id from scope)
     order by c.embedding <=> q_embedding
     limit (select n from params)
  ),
  vec_ranked as (
    select v.id, v.cos, row_number() over (order by v.cos desc, v.id) as pos
      from (select * from vec_all union all select * from vec_scoped) v
     where v.cos is not null
       and v.cos >= coalesce(p_min_cosine, 0)
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
         coalesce(m.rank, 0)::real, m.cos, m.score::real, d.title, d.candidate_id
    from merged m
    join public.rag_chunks c on c.id = m.id
    join public.rag_documents d on d.id = c.document_id
   order by m.score desc, c.id
   limit (select n from params);
$$;

-- ---- Vue d'ensemble d'un candidat (ligne de « registre ») --------------------------
-- Une ligne par candidat : identité, formation, compétences principales,
-- dernière candidature et son résultat, affectation, notes, CV indexé.
-- Fonction et non vue : une vue serait exposée par l'API REST de Supabase.

create or replace function public.assistant_candidate_rows()
returns table (
  candidate_id bigint,
  name text,
  email text,
  field_of_study text,
  education_level text,
  university text,
  years_experience numeric,
  skills text[],
  last_application_id bigint,
  last_status text,
  last_offer text,
  last_score numeric,
  applied_at timestamptz,
  applications int,
  assignment_status text,
  assignment_offer text,
  notes int,
  cv_indexed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    trim(c.first_name || ' ' || c.last_name),
    c.email,
    c.field_of_study,
    c.education_level,
    c.university,
    c.years_experience,
    coalesce(
      (select array_agg(s.name order by cs.weight desc, s.name)
         from (select * from public.candidate_skills x where x.candidate_id = c.id
                order by x.weight desc limit 8) cs
         join public.skills s on s.id = cs.skill_id),
      '{}'::text[]),
    la.id,
    la.status,
    lo.title,
    la.match_score,
    la.created_at,
    (select count(*)::int from public.applications a where a.candidate_id = c.id),
    asg.status,
    ao.title,
    (select count(*)::int from public.candidate_notes n where n.candidate_id = c.id),
    exists (select 1 from public.rag_documents d where d.candidate_id = c.id)
  from public.candidates c
  left join lateral (
    select a.* from public.applications a
     where a.candidate_id = c.id
     order by a.created_at desc, a.id desc
     limit 1
  ) la on true
  left join public.internship_offers lo on lo.id = la.offer_id
  left join lateral (
    select g.* from public.assignments g
     where g.candidate_id = c.id
     order by (g.status = 'confirmed') desc, g.updated_at desc
     limit 1
  ) asg on true
  left join public.internship_offers ao on ao.id = asg.offer_id;
$$;

create or replace function public.assistant_roster(p_limit int default 40)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(to_jsonb(r) - 'email')
    from public.assistant_candidate_rows() r
   order by r.applied_at desc nulls last, r.candidate_id
   limit greatest(1, least(coalesce(p_limit, 40), 500));
$$;

-- ---- Chiffres globaux -------------------------------------------------------------------

create or replace function public.assistant_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'candidats', (select count(*) from public.candidates),
    'candidats_avec_cv_indexe',
      (select count(distinct d.candidate_id) from public.rag_documents d where d.candidate_id is not null),
    'extraits_en_attente_de_vecteur',
      (select count(*) from public.rag_chunks c where c.embedding is null),
    'autres_documents', (select count(*) from public.rag_documents d where d.candidate_id is null),
    'candidatures', jsonb_build_object(
      'total', (select count(*) from public.applications),
      'par_statut', coalesce(
        (select jsonb_object_agg(status, n) from
          (select status, count(*) n from public.applications group by status) s), '{}'::jsonb),
      'sans_offre', (select count(*) from public.applications where offer_id is null),
      '7_derniers_jours', (select count(*) from public.applications where created_at > now() - interval '7 days')
    ),
    'offres', jsonb_build_object(
      'par_statut', coalesce(
        (select jsonb_object_agg(status, n) from
          (select status, count(*) n from public.internship_offers group by status) s), '{}'::jsonb),
      'places_ouvertes', coalesce((select sum(slots) from public.internship_offers where status = 'open'), 0),
      'places_pourvues', (select count(*) from public.assignments g
                            join public.internship_offers o on o.id = g.offer_id
                           where o.status = 'open' and g.status = 'confirmed')
    ),
    'affectations', coalesce(
      (select jsonb_object_agg(status, n) from
        (select status, count(*) n from public.assignments group by status) s), '{}'::jsonb),
    'demandes_echange_en_attente',
      (select count(*) from public.offer_switch_requests where status = 'pending'),
    'notes', (select count(*) from public.candidate_notes)
  );
$$;

-- ---- Résolution d'un nom ---------------------------------------------------------------
-- « 12 », « #12 », un e-mail, ou un nom (même partiel, particules ignorées). Peut
-- renvoyer plusieurs personnes : c'est à l'assistant de demander laquelle.

create or replace function public.assistant_resolve_candidate(q text, p_limit int default 5)
returns table (candidate_id bigint, name text, field_of_study text, match text, similarity real)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select btrim(coalesce(q, '')) as raw,
           public.rag_name_core(coalesce(q, '')) as core
  ),
  by_id as (
    select c.id, 'id'::text as match, 1::real as sim
      from public.candidates c, input
     where input.raw ~ '^#?[0-9]+$'
       and c.id = ltrim(input.raw, '#')::bigint
  ),
  by_email as (
    select c.id, 'email'::text as match, 1::real as sim
      from public.candidates c, input
     where position('@' in input.raw) > 0
       and lower(c.email) = lower(input.raw)
  ),
  by_name as (
    select c.id,
           case when public.rag_name_core(c.first_name || ' ' || c.last_name) = input.core
                then 'nom_exact' else 'nom_proche' end as match,
           greatest(
             word_similarity(input.core, public.rag_name_core(c.first_name || ' ' || c.last_name)),
             similarity(input.core, public.rag_name_core(c.first_name || ' ' || c.last_name))
           )::real as sim
      from public.candidates c, input
     where input.core <> ''
       and input.raw !~ '^#?[0-9]+$'
       and position('@' in input.raw) = 0
  ),
  hits as (
    select * from by_id
    union all select * from by_email
    union all select * from by_name where sim >= 0.5
  )
  select h.id, trim(c.first_name || ' ' || c.last_name), c.field_of_study, h.match, h.sim
    from hits h
    join public.candidates c on c.id = h.id
   order by h.sim desc, h.id
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

-- ---- Dossier complet d'un candidat -----------------------------------------------------

create or replace function public.assistant_candidate_dossier(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'candidate_id', c.id,
    'name', trim(c.first_name || ' ' || c.last_name),
    'email', c.email,
    'phone', c.phone,
    'education_level', c.education_level,
    'field_of_study', c.field_of_study,
    'university', c.university,
    'years_experience', c.years_experience,
    'profile', c.profile,
    'fiche_notes', nullif(btrim(coalesce(c.notes, '')), ''),
    'skills', coalesce(
      (select jsonb_agg(s.name order by cs.weight desc, s.name)
         from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
        where cs.candidate_id = c.id), '[]'::jsonb),
    'applications', coalesce(
      (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'application_id', a.id,
          'offer', o.title,
          'offer_id', o.id,
          'department', dep.name,
          'status', a.status,
          'match_score', a.match_score,
          'applied_at', a.created_at,
          'start_date', a.start_date,
          'end_date', a.end_date,
          'duration_months', a.duration_months,
          'motivation', left(nullif(btrim(coalesce(a.motivation, '')), ''), 400),
          'timeline', (select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'at', e.created_at)
                                        order by e.created_at)
                         from public.application_events e where e.application_id = a.id),
          'assignment', (select jsonb_strip_nulls(jsonb_build_object(
                                  'assignment_id', g.id,
                                  'status', g.status,
                                  'offer', go.title,
                                  'match_score', g.match_score,
                                  'score_breakdown', g.score_breakdown,
                                  'decided_by', g.decided_by,
                                  'updated_at', g.updated_at))
                           from public.assignments g
                           left join public.internship_offers go on go.id = g.offer_id
                          where g.application_id = a.id)
        )) order by a.created_at desc)
         from public.applications a
         left join public.internship_offers o on o.id = a.offer_id
         left join public.departments dep on dep.id = o.department_id
        where a.candidate_id = c.id), '[]'::jsonb),
    'switch_requests', (select jsonb_agg(jsonb_build_object(
                              'status', r.status,
                              'from', fo.title,
                              'to', t.title,
                              'at', r.created_at) order by r.created_at desc)
                          from public.offer_switch_requests r
                          left join public.internship_offers fo on fo.id = r.current_offer_id
                          left join public.internship_offers t on t.id = r.requested_offer_id
                         where r.candidate_id = c.id),
    'notes', (select jsonb_agg(jsonb_build_object(
                     'body', n.body, 'author', n.author_name, 'source', n.source, 'at', n.created_at)
                     order by n.created_at desc)
                from (select * from public.candidate_notes x where x.candidate_id = c.id
                       order by x.created_at desc limit 20) n),
    'documents', (select jsonb_agg(jsonb_build_object(
                         'title', coalesce(d.title, d.name),
                         'doc_type', d.doc_type,
                         'chunks', d.chunk_count,
                         'pages', (select max(k.page) from public.rag_chunks k where k.document_id = d.id)))
                    from public.rag_documents d where d.candidate_id = c.id)
  ))
  from public.candidates c
  where c.id = p_id;
$$;

-- ---- Notes du recruteur -------------------------------------------------------------------

create or replace function public.assistant_save_note(
  p_candidate_id bigint,
  p_author_id uuid,
  p_author_name text,
  p_body text,
  p_source text default 'assistant'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.candidate_notes;
begin
  if not exists (select 1 from public.candidates where id = p_candidate_id) then
    raise exception 'candidat introuvable: %', p_candidate_id using errcode = 'P0002';
  end if;
  insert into public.candidate_notes (candidate_id, author_id, author_name, body, source)
  values (p_candidate_id, p_author_id, nullif(btrim(coalesce(p_author_name, '')), ''),
          btrim(coalesce(p_body, '')), coalesce(p_source, 'assistant'))
  returning * into v_note;
  return jsonb_build_object(
    'note_id', v_note.id,
    'candidate_id', v_note.candidate_id,
    'body', v_note.body,
    'author', v_note.author_name,
    'at', v_note.created_at
  );
end;
$$;

-- ---- Recherche structurée de candidats -----------------------------------------------
-- Filtres combinables ; sans aucun critère, liste tout le monde. Avec `q`, le
-- classement plein-texte + nom de search_candidates ordonne le résultat.

create or replace function public.assistant_find_candidates(
  q text default null,
  p_field text default null,
  p_skills text[] default null,
  p_education text default null,
  p_status text default null,
  p_offer text default null,
  p_min_years numeric default null,
  p_limit int default 20
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select s.candidate_id, s.rank
      from public.search_candidates(q, p_min_years, p_education, 20) s
     where nullif(btrim(coalesce(q, '')), '') is not null
  ),
  rows as (
    select r.*, rk.rank
      from public.assistant_candidate_rows() r
      left join ranked rk on rk.candidate_id = r.candidate_id
     where (nullif(btrim(coalesce(q, '')), '') is null or rk.candidate_id is not null)
       and (p_field is null
            or r.field_of_study ilike '%' || public.rag_like_escape(p_field) || '%')
       and (p_education is null
            or r.education_level ilike '%' || public.rag_like_escape(p_education) || '%')
       and (p_min_years is null or r.years_experience >= p_min_years)
       and (p_status is null
            or exists (select 1 from public.applications a
                        where a.candidate_id = r.candidate_id and a.status = p_status))
       and (p_offer is null
            or exists (select 1 from public.applications a
                         join public.internship_offers o on o.id = a.offer_id
                        where a.candidate_id = r.candidate_id
                          and (o.id::text = btrim(p_offer)
                               or o.title ilike '%' || public.rag_like_escape(p_offer) || '%')))
       and (p_skills is null or cardinality(p_skills) = 0
            or not exists (
              select 1 from unnest(p_skills) want(skill)
               where not exists (
                 select 1 from public.candidate_skills cs
                   join public.skills sk on sk.id = cs.skill_id
                  where cs.candidate_id = r.candidate_id
                    and (sk.normalized = lower(btrim(want.skill))
                         or sk.name ilike btrim(want.skill)))))
  )
  select jsonb_strip_nulls(to_jsonb(rows) - 'email' - 'rank')
    from rows
   order by rows.rank desc nulls last, rows.applied_at desc nulls last, rows.candidate_id
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- ---- Offres ------------------------------------------------------------------------------

create or replace function public.assistant_offers(p_status text default null, p_offer text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'offer_id', o.id,
    'title', o.title,
    'field', o.field,
    'department', dep.name,
    'status', o.status,
    'slots', o.slots,
    'min_education_level', o.min_education_level,
    'candidatures', (select count(*) from public.applications a where a.offer_id = o.id),
    'affectes', (select jsonb_agg(trim(c.first_name || ' ' || c.last_name) order by c.last_name)
                   from public.assignments g join public.candidates c on c.id = g.candidate_id
                  where g.offer_id = o.id and g.status = 'confirmed'),
    'description', case when p_offer is not null then left(o.description, 800) end,
    'competences', case when p_offer is not null then
      (select jsonb_agg(jsonb_build_object('skill', s.name, 'required', os.required) order by os.weight desc)
         from public.offer_skills os join public.skills s on s.id = os.skill_id
        where os.offer_id = o.id) end,
    'candidats', case when p_offer is not null then
      (select jsonb_agg(jsonb_build_object(
                'candidate_id', c.id,
                'name', trim(c.first_name || ' ' || c.last_name),
                'status', a.status,
                'match_score', a.match_score) order by a.match_score desc nulls last)
         from public.applications a join public.candidates c on c.id = a.candidate_id
        where a.offer_id = o.id) end
  ))
  from public.internship_offers o
  left join public.departments dep on dep.id = o.department_id
  where (p_status is null or o.status = p_status)
    and (p_offer is null
         or o.id::text = btrim(p_offer)
         or o.title ilike '%' || public.rag_like_escape(p_offer) || '%')
  order by o.status, o.title;
$$;

-- ---- Données du classement (rank_candidates) -------------------------------------------

create or replace function public.assistant_ranking_pool()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'applicants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'candidate_id', c.id,
        'application_id', a.id,
        'name', trim(c.first_name || ' ' || c.last_name),
        'status', a.status,
        'education_level', c.education_level,
        'field_of_study', c.field_of_study,
        'years_experience', c.years_experience,
        'skills', coalesce((select jsonb_object_agg(s.normalized, cs.weight)
                              from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
                             where cs.candidate_id = c.id), '{}'::jsonb)
      ) order by a.id)
        from public.applications a join public.candidates c on c.id = a.candidate_id
       where a.status in ('parsed', 'under_review', 'assigned')), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'offer_id', o.id,
        'title', o.title,
        'field', o.field,
        'min_education_level', o.min_education_level,
        'skills', coalesce((select jsonb_agg(jsonb_build_object(
                                'skill', s.normalized, 'weight', os.weight, 'required', os.required))
                              from public.offer_skills os join public.skills s on s.id = os.skill_id
                             where os.offer_id = o.id), '[]'::jsonb)
      ) order by o.id)
        from public.internship_offers o where o.status = 'open'), '[]'::jsonb)
  );
$$;

-- ---- Réservations (affectations confirmées) -------------------------------------------

create or replace function public.assistant_bookings(p_from date default null, p_to date default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'assignment_id', g.id,
    'candidate_id', c.id,
    'name', trim(c.first_name || ' ' || c.last_name),
    'offer', o.title,
    'department', dep.name,
    'start_date', a.start_date,
    'end_date', a.end_date,
    'duration_months', a.duration_months
  ))
  from public.assignments g
  join public.candidates c on c.id = g.candidate_id
  join public.applications a on a.id = g.application_id
  left join public.internship_offers o on o.id = g.offer_id
  left join public.departments dep on dep.id = o.department_id
  where g.status = 'confirmed'
    -- Retenue si la période CHEVAUCHE la fenêtre ; sans dates, seulement sans fenêtre.
    and case
          when a.start_date is null or a.end_date is null then p_from is null and p_to is null
          else (p_from is null or a.end_date >= p_from) and (p_to is null or a.start_date <= p_to)
        end
  order by a.start_date nulls last, c.last_name;
$$;

-- ---- Droits ------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rag_replace_document(text, text, jsonb, boolean, bigint, text)',
    'public.rag_list_documents()',
    'public.rag_search_chunks(text, extensions.vector, int, text, real, real, int, bigint)',
    'public.assistant_candidate_rows()',
    'public.assistant_roster(int)',
    'public.assistant_overview()',
    'public.assistant_resolve_candidate(text, int)',
    'public.assistant_candidate_dossier(bigint)',
    'public.assistant_save_note(bigint, uuid, text, text, text)',
    'public.assistant_find_candidates(text, text, text[], text, text, text, numeric, int)',
    'public.assistant_offers(text, text)',
    'public.assistant_ranking_pool()',
    'public.assistant_bookings(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
