-- =============================================================================
-- Recherche de candidats : la faire en base, plus dans la fonction serverless.
--
-- Jusqu'ici `retrieveCandidates` faisait un `select *` SANS limite sur toute la
-- table `candidates`, cv_text compris (jusqu'à 20 000 caractères par profil),
-- puis filtrait en JavaScript avec `String.includes`. Trois conséquences :
--
--   * volume     — jusqu'à ~20 Mo rapatriés par appel, et l'agent peut appeler
--                  l'outil plusieurs fois pour un seul message d'utilisateur ;
--   * silence    — au-delà de la limite de lignes de PostgREST, les candidats
--                  suivants devenaient purement et simplement invisibles ;
--   * pertinence — le score valait hits/nb_termes, sans pondération ni retrait
--                  des mots vides. « Trouve moi les meilleurs candidats qui
--                  connaissent python » donnait 8 termes dont 1 utile : un
--                  expert de 10 ans et un débutant ressortaient tous deux à
--                  0,25, donc impossible de les départager.
--
-- Correctif : un index GIN sur un tsvector pondéré (compétences > formation >
-- texte du CV) plus la similarité trigramme pour retrouver un nom mal
-- orthographié. Le classement et les filtres se font en SQL, la fonction ne
-- reçoit que les k lignes utiles. Postgres assurant la tokenisation, un terme
-- ponctué (« python. ») cesse aussi d'être un terme mort.
-- =============================================================================

create extension if not exists pg_trgm;

-- ---- Compétences dénormalisées ----------------------------------------------
-- Les compétences vivent dans candidate_skills -> skills : une colonne générée
-- ne peut pas les atteindre. On les recopie, entretenues par trigger.

alter table public.candidates add column if not exists skills_text text;

create or replace function public.refresh_candidate_skills_text(p_candidate_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.candidates c
     set skills_text = coalesce(
       (select string_agg(s.name, ' ' order by s.name)
          from public.candidate_skills cs
          join public.skills s on s.id = cs.skill_id
         where cs.candidate_id = p_candidate_id),
       ''
     )
   where c.id = p_candidate_id;
$$;

create or replace function public.touch_candidate_skills_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_candidate_skills_text(
    case when tg_op = 'DELETE' then old.candidate_id else new.candidate_id end
  );
  -- Un changement de candidat sur une même ligne touche les deux profils.
  if tg_op = 'UPDATE' and old.candidate_id is distinct from new.candidate_id then
    perform public.refresh_candidate_skills_text(old.candidate_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_candidate_skills_text on public.candidate_skills;
create trigger trg_candidate_skills_text
  after insert or update or delete on public.candidate_skills
  for each row execute function public.touch_candidate_skills_text();

-- Renommer une compétence doit se répercuter sur tous les profils la portant.
create or replace function public.touch_skill_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.candidates c
       set skills_text = coalesce(
         (select string_agg(s.name, ' ' order by s.name)
            from public.candidate_skills cs
            join public.skills s on s.id = cs.skill_id
           where cs.candidate_id = c.id),
         ''
       )
     where exists (
       select 1 from public.candidate_skills cs
        where cs.candidate_id = c.id and cs.skill_id = new.id
     );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_skill_rename on public.skills;
create trigger trg_skill_rename
  after update on public.skills
  for each row execute function public.touch_skill_rename();

-- Reprise de l'existant (obligatoire : sans cela les profils déjà en base
-- restent avec skills_text à NULL et sortent de toute recherche par compétence).
update public.candidates c
   set skills_text = coalesce(
     (select string_agg(s.name, ' ' order by s.name)
        from public.candidate_skills cs
        join public.skills s on s.id = cs.skill_id
       where cs.candidate_id = c.id),
     ''
   );

-- ---- Vecteur de recherche pondéré -------------------------------------------
-- A compétences · B formation/filière/université · C texte brut du CV.
-- Une compétence explicitement extraite pèse donc plus qu'une occurrence noyée
-- dans le corps du CV, ce que le comptage plat ne savait pas exprimer.

alter table public.candidates drop column if exists search_vector;
alter table public.candidates add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('french',  coalesce(skills_text, '')), 'A')
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

-- Rattrapage des noms approximatifs (« bedda » pour « Beddaoui »).
create index if not exists ix_candidates_name_trgm
  on public.candidates using gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- ---- Retrieval ---------------------------------------------------------------

-- `%` et `_` saisis par l'utilisateur sont des jokers LIKE : sans échappement,
-- « Bac_5 » matcherait « Bac+5 » comme « Bac 5 » ou « BacX5 ».
create or replace function public.rag_like_escape(value text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(replace(replace(coalesce(value, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

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
  -- Toutes les colonnes de sortie sont explicitement nommées : ce sont des
  -- paramètres OUT, donc `order by rank` ne se résout à la bonne expression que
  -- si `rank` est aussi un alias de la liste de sélection.
  with query as (select public.rag_tsquery(q) as tsq)
  select
    c.id                                            as candidate_id,
    trim(c.first_name || ' ' || c.last_name)        as name,
    c.education_level                               as education_level,
    c.field_of_study                                as field_of_study,
    c.years_experience                              as years_experience,
    coalesce(
      (select array_agg(s.name order by s.name)
         from public.candidate_skills cs
         join public.skills s on s.id = cs.skill_id
        where cs.candidate_id = c.id),
      '{}'::text[]
    )                                               as skills,
    greatest(
      ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32),
      -- Un nom bien retrouvé vaut une correspondance forte même si aucun terme
      -- de la question n'apparaît dans le CV.
      similarity(c.first_name || ' ' || c.last_name, coalesce(q, ''))
    )::real                                         as rank,
    similarity(c.first_name || ' ' || c.last_name, coalesce(q, ''))::real
                                                    as name_similarity
  from public.candidates c, query
  where
    -- Filtres structurés : appliqués en SQL, jamais après coup en mémoire.
    (min_years is null or c.years_experience >= min_years)
    and (
      education is null
      or c.education_level ilike '%' || public.rag_like_escape(education) || '%'
    )
    -- Une recherche purement structurée (« tous les Bac+5 ») est légitime : sans
    -- terme exploitable on garde le filtre seul, sinon on exige une vraie
    -- correspondance textuelle ou un nom proche.
    and (
      query.tsq = ''::tsquery
      or c.search_vector @@ query.tsq
      or similarity(c.first_name || ' ' || c.last_name, coalesce(q, '')) > 0.3
    )
  order by rank desc, c.id
  limit greatest(1, least(top_k, 20));
$$;

-- Pourquoi une recherche est vide. Appelé UNIQUEMENT quand il n'y a aucun
-- résultat : le chemin nominal ne paie pas ce comptage.
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
       or c.search_vector @@ query.tsq
       or similarity(c.first_name || ' ' || c.last_name, coalesce(q, '')) > 0.3
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
    -- years_experience vaut 0 quand l'analyse du CV n'a pas su l'extraire :
    -- « aucune expérience » et « expérience inconnue » sont indiscernables.
    (select count(*) from matched m
      where min_years is not null and m.years_experience = 0)       as experience_unknown;
$$;

revoke all on function public.search_candidates(text, numeric, text, int)
  from public, anon, authenticated;
revoke all on function public.search_candidates_diag(text, numeric, text)
  from public, anon, authenticated;
revoke all on function public.refresh_candidate_skills_text(bigint)
  from public, anon, authenticated;
revoke all on function public.rag_like_escape(text) from public, anon, authenticated;

grant execute on function public.search_candidates(text, numeric, text, int) to service_role;
grant execute on function public.search_candidates_diag(text, numeric, text) to service_role;
grant execute on function public.rag_like_escape(text) to service_role;
