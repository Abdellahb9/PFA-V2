-- =============================================================================
-- Ingestion documentaire atomique.
--
-- `ingestDocumentText` faisait un DELETE puis un INSERT en DEUX requêtes
-- distinctes. Si l'insertion échouait — lot trop volumineux, coupure réseau,
-- timeout de la fonction — le DELETE, lui, était déjà validé : le document
-- disparaissait entièrement de la base documentaire, et l'appelant recevait une
-- erreur 500 sans le moindre retour en arrière. Réingérer un document existant
-- revenait donc à jouer son intégrité à pile ou face.
--
-- Ici les deux opérations sont dans la même transaction : soit les nouveaux
-- extraits remplacent les anciens, soit rien ne bouge. L'insertion en masse
-- depuis un tableau JSON évite au passage de dépendre de la taille de requête
-- côté client pour un gros PDF (~1 250 extraits).
-- =============================================================================

create or replace function public.replace_document_chunks(
  p_source_document text,
  p_chunks jsonb
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

  delete from public.document_chunks where source_document = p_source_document;

  insert into public.document_chunks (source_document, chunk_text, chunk_index)
  select p_source_document, chunk.value, (chunk.ordinality - 1)::int
    from jsonb_array_elements_text(coalesce(p_chunks, '[]'::jsonb))
         with ordinality as chunk(value, ordinality)
   where btrim(chunk.value) <> '';

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_document_chunks(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_document_chunks(text, jsonb) to service_role;
