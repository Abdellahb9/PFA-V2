-- =============================================================================
-- La politique de stage sort du produit : la base documentaire ne contient
-- plus que des CV et des documents sur les candidats (« other » : comptes
-- rendus d'entretien, fiches…).
--
--   · les documents « policy » existants deviennent « other » (rien n'est
--     supprimé : ils restent consultables et supprimables depuis l'interface) ;
--   · le type par défaut devient « other » ;
--   · la contrainte et rag_replace_document n'acceptent plus « policy ».
--
-- Rejouable : chaque instruction tolère d'avoir déjà été appliquée.
-- =============================================================================

update public.rag_documents set doc_type = 'other' where doc_type = 'policy';

alter table public.rag_documents alter column doc_type set default 'other';

alter table public.rag_documents drop constraint if exists rag_documents_doc_type_check;
alter table public.rag_documents
  add constraint rag_documents_doc_type_check check (doc_type in ('cv', 'other'));

-- Corps identique à 0019, seule la liste des types change.
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

revoke all on function public.rag_replace_document(text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.rag_replace_document(text, text, jsonb, boolean) to service_role;
