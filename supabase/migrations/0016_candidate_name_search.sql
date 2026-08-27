-- =============================================================================
-- Recherche par NOM de candidat : corriger 0014.
--
-- 0014 pondérait les compétences en A, la formation en B et le texte du CV en C
-- — mais oubliait purement et simplement `first_name` / `last_name`. Le nom
-- n'entrait donc dans l'index que par accident, noyé dans `cv_text`, au poids le
-- plus faible. Conséquence observée sur « Quelle université de bedda meriem ? » :
-- deux candidats sans rapport ressortaient à égalité (44 %), parce que le seul
-- signal était « bedda » croisé quelque part dans leur CV.
--
-- Le repêchage par trigrammes ne compensait pas : `similarity(nom, q)` compare
-- deux chaînes ENTIÈRES et s'effondre dès que la question est longue —
--   similarity('meriem bedda', 'Quelle université de bedda meriem ?')  ≈ 0,3
--   word_similarity('meriem bedda', 'Quelle université de bedda meriem ?') ≈ 1,0
-- `word_similarity` répond à la bonne question : « ce nom figure-t-il parmi les
-- mots de la requête ? ». C'est celle qu'on pose.
--
-- Après application, les profils existants sont réindexés automatiquement : la
-- colonne étant générée, Postgres la recalcule à la réécriture de la table.
-- =============================================================================

alter table public.candidates drop column if exists search_vector;
alter table public.candidates add column search_vector tsvector
  generated always as (
    -- A · le nom, désormais au même rang que les compétences. Indexé avec les
    -- deux configurations, comme rag_tsquery construit la requête.
    setweight(to_tsvector('french',
      coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A')
    || setweight(to_tsvector('english',
         coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A')
    -- A · compétences extraites
    || setweight(to_tsvector('french',  coalesce(skills_text, '')), 'A')
    || setweight(to_tsvector('english', coalesce(skills_text, '')), 'A')
    -- B · formation, filière, établissement
    || setweight(to_tsvector('french',
         coalesce(field_of_study, '') || ' ' || coalesce(education_level, '') || ' '
         || coalesce(university, '')), 'B')
    || setweight(to_tsvector('english',
         coalesce(field_of_study, '') || ' ' || coalesce(education_level, '') || ' '
         || coalesce(university, '')), 'B')
    -- C · texte brut du CV
    || setweight(to_tsvector('french',  coalesce(cv_text, '')), 'C')
    || setweight(to_tsvector('english', coalesce(cv_text, '')), 'C')
  ) stored;

create index if not exists ix_candidates_fts
  on public.candidates using gin (search_vector);

-- ---- Retrieval ---------------------------------------------------------------
-- Seuil de word_similarity : plus exigeant que l'ancien similarity > 0.3, qui
-- ne filtrait pratiquement rien une fois la question un peu longue.
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
      word_similarity(trim(c.first_name || ' ' || c.last_name), coalesce(q, ''))
    )::real                                         as rank,
    word_similarity(trim(c.first_name || ' ' || c.last_name), coalesce(q, ''))::real
                                                    as name_similarity
  from public.candidates c, query
  where
    (min_years is null or c.years_experience >= min_years)
    and (
      education is null
      or c.education_level ilike '%' || public.rag_like_escape(education) || '%'
    )
    and (
      query.tsq = ''::tsquery
      or c.search_vector @@ query.tsq
      or word_similarity(trim(c.first_name || ' ' || c.last_name), coalesce(q, '')) > 0.6
    )
  order by rank desc, c.id
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
       or c.search_vector @@ query.tsq
       or word_similarity(trim(c.first_name || ' ' || c.last_name), coalesce(q, '')) > 0.6
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

revoke all on function public.search_candidates(text, numeric, text, int)
  from public, anon, authenticated;
revoke all on function public.search_candidates_diag(text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.search_candidates(text, numeric, text, int) to service_role;
grant execute on function public.search_candidates_diag(text, numeric, text) to service_role;

-- ---- Durcissement demandé par le Security Advisor ----------------------------
-- search_path figé sur les deux fonctions de 0013/0014 qui l'avaient laissé
-- mutable, et retrait du droit d'exécution des fonctions de trigger : elles
-- n'ont aucune raison d'être appelables directement par un utilisateur connecté.

create or replace function public.rag_like_escape(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select replace(replace(replace(coalesce(value, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.rag_tsquery(q text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  cleaned   text;
  excluded  text;
  positives text;
  negatives text;
begin
  q := coalesce(q, '');

  select string_agg(m[1], ' ') into excluded
    from regexp_matches(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', 'g') as m;
  cleaned := regexp_replace(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', ' ', 'g');

  select string_agg(quote_literal(lexeme), ' | ') into positives
    from (
      select lexeme from unnest(to_tsvector('french',  cleaned))
      union
      select lexeme from unnest(to_tsvector('english', cleaned))
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

revoke all on function public.touch_candidate_skills_text() from public, anon, authenticated;
revoke all on function public.touch_skill_rename() from public, anon, authenticated;
revoke all on function public.touch_assistant_conversation() from public, anon, authenticated;
