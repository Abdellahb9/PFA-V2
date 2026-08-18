-- =============================================================================
-- Recherche documentaire : passer d'une sémantique ET à une sémantique OU.
--
-- `websearch_to_tsquery` relie les mots par ET : « Quelle université ? » exige
-- que l'extrait contienne À LA FOIS « quelle » ET « université ». Or les mots
-- interrogatifs (quelle, combien, comment…) ne figurent jamais dans un document
-- de référence — donc toute question formulée en langue naturelle ne renvoyait
-- aucun résultat, alors que le mot-clé seul en renvoyait.
--
-- Vérifié sur la base avant correction :
--   « université »            -> 1 résultat
--   « université langues »    -> 1 résultat  (les deux mots sont dans l'extrait)
--   « quelle université »     -> 0 résultat  (« quelle » absent de l'extrait)
--   « université xyzzy »      -> 0 résultat  (un mot absent suffit à tout annuler)
--
-- Correctif : convertir les ET du tsquery en OU, et laisser ts_rank classer.
-- Les extraits contenant le plus de termes de la question remontent en tête ;
-- ceux qui n'en contiennent aucun sont toujours écartés.
-- =============================================================================

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
  with parsed as (
    -- La forme textuelle d'un tsquery sépare les termes par ' & ' : en faire
    -- des ' | ' donne la disjonction. Les phrases entre guillemets (opérateur
    -- <->) et la négation (!) posées par websearch_to_tsquery sont préservées.
    select
      nullif(replace(websearch_to_tsquery('french',  q)::text, '&', '|'), '')::tsquery as fr,
      nullif(replace(websearch_to_tsquery('english', q)::text, '&', '|'), '')::tsquery as en
  ),
  query as (
    select coalesce(fr, ''::tsquery) || coalesce(en, ''::tsquery) as tsq from parsed
  )
  select c.source_document, c.chunk_index, c.chunk_text,
         ts_rank(c.search_vector, query.tsq) as rank
  from public.document_chunks c, query
  where query.tsq != ''::tsquery
    and c.search_vector @@ query.tsq
  order by rank desc, c.source_document, c.chunk_index
  limit greatest(1, least(top_k, 20));
$$;

-- Service-role uniquement (les fonctions imposent elles-mêmes l'auth staff).
revoke all on function public.search_document_chunks(text, int) from public, anon, authenticated;
