-- =============================================================================
-- Pertinence de la recherche de candidats : corriger le score de 0016.
--
-- Constaté en production sur « Quelle filière de Babtich El Habib ? » :
--     Youssef El Khattabi  71 %
--     bedda ABDEL          55 %
--     m bed                44 %
-- Aucun n'a le moindre rapport avec la question. Trois causes distinctes.
--
-- (a) DEUX ÉCHELLES INCOMPARABLES FUSIONNÉES PAR greatest().
--     ts_rank_cd(..., 32) est borné dans [0,1[ mais se concentre en bas
--     (0,05–0,35 en pratique) ; word_similarity vit dans [0,1] et est bien plus
--     généreux. `greatest` renvoyait donc presque toujours le score trigramme :
--     la barre « Pertinence » affichait un TAUX DE RECOUVREMENT DE LETTRES, pas
--     une pertinence. D'où 71 % pour un profil sans rapport.
--
-- (b) LES PARTICULES DE NOM NE SONT PAS DES MOTS VIDES.
--     « el » survit à to_tsvector en français comme en anglais. La question
--     « Babtich El Habib » porte donc le lexème 'el', qui matche « Youssef El
--     Khattabi » au POIDS A — le plus fort, celui réservé au nom depuis 0016.
--     Tous les noms marocains en El / Ben / Aït entrent en collision.
--
-- (c) AUCUN PLANCHER. Tout ce qui passait le WHERE était affiché.
--
-- Correctif : les deux signaux restent SÉPARÉS et ne se mélangent plus par
-- hasard ; le nom est indexé et comparé sans ses particules ; un plancher est
-- appliqué ici et re-appliqué côté TypeScript.
-- =============================================================================

-- ---- Noyau d'un nom ---------------------------------------------------------
-- Retire les particules qui ne distinguent personne. « Youssef El Khattabi »
-- -> « youssef khattabi » ; « Babtich El Habib » -> « babtich habib ».
create or replace function public.rag_name_core(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(regexp_replace(
    ' ' || lower(coalesce(value, '')) || ' ',
    -- particules courantes au Maroc et au Maghreb, isolées entre espaces
    '\s+(el|al|ben|bin|ibn|ait|ait-|ould|abd|abou|abu|bou|da|de|du|le|la|des)\s+',
    ' ', 'g'
  ));
$$;

-- ---- Vecteur de recherche ---------------------------------------------------
-- Le nom entre au poids A SANS ses particules : 'el' ne peut plus hisser un
-- homonyme partiel au sommet du classement.
alter table public.candidates drop column if exists search_vector;
alter table public.candidates add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', public.rag_name_core(
      coalesce(first_name, '') || ' ' || coalesce(last_name, ''))), 'A')
    || setweight(to_tsvector('french',  coalesce(skills_text, '')), 'A')
    || setweight(to_tsvector('english', coalesce(skills_text, '')), 'A')
    || setweight(to_tsvector('french',
         coalesce(field_of_study, '') || ' ' || coalesce(education_level, '') || ' '
         || coalesce(university, '')), 'B')
    || setweight(to_tsvector('english',
         coalesce(field_of_study, '') || ' ' || coalesce(education_level, '') || ' '
         || coalesce(university, '')), 'B')
    || setweight(to_tsvector('french',  coalesce(cv_text, '')), 'C')
    || setweight(to_tsvector('english', coalesce(cv_text, '')), 'C')
  ) stored;

create index if not exists ix_candidates_fts
  on public.candidates using gin (search_vector);

-- ---- Retrieval ---------------------------------------------------------------
-- NAME_MATCH_MIN : au-dessus, on tient un vrai match de nom ; en dessous, la
-- ressemblance est fortuite et ne doit pas peser sur le classement.
-- RELEVANCE_MIN  : plancher absolu. Rien en dessous ne remonte.
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
  query as (select public.rag_tsquery(q) as tsq),
  scored as (
    select
      c.id,
      trim(c.first_name || ' ' || c.last_name) as full_name,
      c.education_level,
      c.field_of_study,
      c.years_experience,
      -- Pertinence textuelle : compétences (A), formation (B), CV (C).
      ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32)::real
        as text_rank,
      -- Correspondance de nom, particules retirées des DEUX côtés.
      word_similarity(
        public.rag_name_core(c.first_name || ' ' || c.last_name),
        public.rag_name_core(coalesce(q, ''))
      )::real as name_sim
    from public.candidates c, query
    where (min_years is null or c.years_experience >= min_years)
      and (education is null
           or c.education_level ilike '%' || public.rag_like_escape(education) || '%')
  )
  select
    s.id                as candidate_id,
    s.full_name         as name,
    s.education_level   as education_level,
    s.field_of_study    as field_of_study,
    s.years_experience  as years_experience,
    coalesce(
      (select array_agg(sk.name order by sk.name)
         from public.candidate_skills cs
         join public.skills sk on sk.id = cs.skill_id
        where cs.candidate_id = s.id),
      '{}'::text[]
    )                   as skills,
    -- Les deux signaux ne sont PLUS fusionnés au hasard : un nom ne compte que
    -- s'il constitue une vraie identification.
    greatest(
      s.text_rank,
      case when s.name_sim >= p.name_match_min then s.name_sim else 0::real end
    )                   as rank,
    s.name_sim          as name_similarity
  from scored s, params p, query
  where
    -- Une recherche purement structurée (« tous les Bac+5 ») reste légitime.
    (query.tsq = ''::tsquery and (min_years is not null or education is not null))
    or greatest(
         s.text_rank,
         case when s.name_sim >= p.name_match_min then s.name_sim else 0::real end
       ) >= p.relevance_min
  order by rank desc, s.id
  limit greatest(1, least(top_k, 20));
$$;

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
  with query as (select public.rag_tsquery(q) as tsq),
  matched as (
    select c.*
    from public.candidates c, query
    where query.tsq = ''::tsquery
       or ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32) >= 0.06
       or word_similarity(
            public.rag_name_core(c.first_name || ' ' || c.last_name),
            public.rag_name_core(coalesce(q, ''))
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

revoke all on function public.rag_name_core(text) from public, anon, authenticated;
revoke all on function public.search_candidates(text, numeric, text, int)
  from public, anon, authenticated;
revoke all on function public.search_candidates_diag(text, numeric, text)
  from public, anon, authenticated;

grant execute on function public.rag_name_core(text) to service_role;
grant execute on function public.search_candidates(text, numeric, text, int) to service_role;
grant execute on function public.search_candidates_diag(text, numeric, text) to service_role;
