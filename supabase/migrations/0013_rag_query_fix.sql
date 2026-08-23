-- =============================================================================
-- Recherche documentaire : construire le tsquery correctement, et renvoyer un
-- score de pertinence ABSOLU.
--
-- 1. NÉGATION CASSÉE (correctif du 0010).
--    0010 voulait rendre les mots interrogatifs non bloquants et le faisait par
--    `replace(websearch_to_tsquery(...)::text, '&', '|')`. Ce remplacement de
--    chaîne ne distingue pas le ET de la NÉGATION :
--       « stage -alternance »  ->  'stag' & !'altern'      (attendu)
--                              ->  'stag' | !'altern'      (obtenu)
--    Le second matche TOUT extrait ne contenant pas « altern », soit quasiment
--    toute la table : l'exclusion demandée devenait son contraire.
--    Correctif : `rag_tsquery` assemble la disjonction à partir des LEXÈMES
--    (to_tsvector a déjà retiré les mots vides — « quelle université » se réduit
--    à « universit »), et réinjecte les exclusions en `!`, sans jamais réécrire
--    la forme textuelle d'un tsquery.
--
-- 2. SCORE RELATIF (correctif côté appelant).
--    Le code TypeScript normalisait le rang sur le meilleur résultat, donc le
--    premier extrait affichait TOUJOURS « pertinence 100 % », fût-il hors sujet.
--    `ts_rank_cd(..., 32)` (soit rank/(rank+1)) renvoie une valeur dans [0, 1[
--    comparable d'une requête à l'autre : l'appelant peut enfin appliquer un
--    seuil plancher au lieu d'une normalisation trompeuse.
--
-- 3. PONDÉRATION BILINGUE.
--    0008 concaténait les deux vecteurs sans poids, donc un mot identique en
--    français et en anglais comptait double et gonflait son rang. Les deux
--    configurations reçoivent maintenant des poids distincts (A / B).
-- =============================================================================

-- ---- Constructeur de requête partagé ----------------------------------------

create or replace function public.rag_tsquery(q text)
returns tsquery
language plpgsql
immutable
parallel safe
as $$
declare
  cleaned   text;
  excluded  text;
  positives text;
  negatives text;
begin
  q := coalesce(q, '');

  -- Termes explicitement exclus (« stage -alternance ») : on les met de côté,
  -- puis on les retire du texte qui construira la partie positive.
  select string_agg(m[1], ' ') into excluded
    from regexp_matches(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', 'g') as m;
  cleaned := regexp_replace(q, '(?:^|\s)-([[:alnum:]_À-ÿ]+)', ' ', 'g');

  -- Partie positive : les lexèmes des DEUX configurations, reliés par OU.
  select string_agg(quote_literal(lexeme), ' | ') into positives
    from (
      select lexeme from unnest(to_tsvector('french',  cleaned))
      union
      select lexeme from unnest(to_tsvector('english', cleaned))
    ) u;

  -- Requête vide (que des mots vides) : l'appelant doit l'écarter, pas la jouer.
  if positives is null then
    return ''::tsquery;
  end if;

  if excluded is null then
    return positives::tsquery;
  end if;

  -- Les exclusions sont stemmées avec les mêmes configurations, sinon
  -- `!alternance` ne rencontrerait jamais le lexème stocké `altern`.
  select string_agg('!' || quote_literal(lexeme), ' & ') into negatives
    from (
      select lexeme from unnest(to_tsvector('french',  excluded))
      union
      select lexeme from unnest(to_tsvector('english', excluded))
    ) u;

  if negatives is null then
    return positives::tsquery;
  end if;

  -- Parenthèses obligatoires : en tsquery, & lie plus fort que |.
  return ('(' || positives || ') & ' || negatives)::tsquery;
end;
$$;

comment on function public.rag_tsquery(text) is
  'Disjonction des lexèmes d''une question en langue naturelle, exclusions -mot préservées.';

-- ---- Vecteur pondéré ---------------------------------------------------------

alter table public.document_chunks drop column if exists search_vector;
alter table public.document_chunks add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('french',  coalesce(chunk_text, '')), 'A')
    || setweight(to_tsvector('english', coalesce(chunk_text, '')), 'B')
  ) stored;

create index if not exists ix_document_chunks_fts
  on public.document_chunks using gin (search_vector);

-- ---- Retrieval ---------------------------------------------------------------

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
  with query as (select public.rag_tsquery(q) as tsq)
  select c.source_document, c.chunk_index, c.chunk_text,
         -- 32 = rank/(rank+1) : borne le score dans [0, 1[ et le rend
         -- comparable entre requêtes, ce qu'un rang brut ne permet pas.
         ts_rank_cd('{0.1, 0.2, 0.4, 1.0}'::float4[], c.search_vector, query.tsq, 32) as rank
  from public.document_chunks c, query
  where query.tsq != ''::tsquery
    and c.search_vector @@ query.tsq
  order by rank desc, c.source_document, c.chunk_index
  limit greatest(1, least(top_k, 20));
$$;

-- Comptage des documents ingérés. Ramener toutes les lignes pour les compter
-- côté fonction plafonnait à la limite de lignes de PostgREST : au-delà, les
-- totaux étaient faux et un document entier pouvait disparaître de la liste.
create or replace function public.list_document_chunk_counts()
returns table (source_document text, chunks bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.source_document, count(*) as chunks
  from public.document_chunks c
  group by c.source_document
  order by c.source_document;
$$;

-- ---- Droits ------------------------------------------------------------------
-- Les fonctions imposent elles-mêmes l'auth staff côté serverless. On révoque
-- l'accès public, PUIS on redonne explicitement à service_role : jusqu'ici cela
-- reposait sur les privilèges par défaut de Supabase survivant au revoke.

revoke all on function public.rag_tsquery(text) from public, anon, authenticated;
revoke all on function public.search_document_chunks(text, int) from public, anon, authenticated;
revoke all on function public.list_document_chunk_counts() from public, anon, authenticated;

grant execute on function public.rag_tsquery(text) to service_role;
grant execute on function public.search_document_chunks(text, int) to service_role;
grant execute on function public.list_document_chunk_counts() to service_role;

-- ---- Durcissement 0011 -------------------------------------------------------
-- Un search_path non figé sur une fonction de trigger laisse la résolution des
-- noms dépendre de l'appelant.

create or replace function public.touch_assistant_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assistant_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;
