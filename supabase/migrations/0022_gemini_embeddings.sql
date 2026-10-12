-- =============================================================================
-- Vecteurs : Mistral (mistral-embed, 1024 dimensions) → Google Gemini
-- (gemini-embedding-2, 768 dimensions).
--
-- Les deux espaces de vecteurs sont incompatibles : les vecteurs Mistral sont
-- EFFACÉS et les extraits repassent « en attente ». Ils restent trouvables en
-- plein-texte, et la vectorisation les reprend avec GEMINI_API_KEY :
-- réindexation (page Assistant ou `npm run reindex`), tâche /api/rag-embed, ou
-- son Cron quotidien.
--
-- Rejouable : le bloc ne fait rien si la colonne est déjà en vector(768) — un
-- rejeu n'efface donc jamais des vecteurs Gemini.
-- =============================================================================

do $$
declare
  v_dim int;
begin
  select a.atttypmod into v_dim
    from pg_attribute a
   where a.attrelid = 'public.rag_chunks'::regclass
     and a.attname = 'embedding'
     and not a.attisdropped;

  if v_dim is distinct from 768 then
    drop index if exists public.ix_rag_chunks_embedding;
    update public.rag_chunks set embedding = null, embedded_at = null where embedding is not null;
    alter table public.rag_chunks alter column embedding type extensions.vector(768);
    create index ix_rag_chunks_embedding on public.rag_chunks
      using hnsw (embedding extensions.vector_cosine_ops);
  end if;
end;
$$;

-- rag_search_chunks (0021) n'a pas à changer : Postgres ignore la dimension
-- déclarée d'un paramètre de fonction (vector(1024) y vaut vector). La colonne,
-- elle, refuse désormais tout vecteur qui n'a pas 768 dimensions.
