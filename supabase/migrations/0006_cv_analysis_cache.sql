-- =============================================================================
-- CV analysis cache: skip the Groq extraction call when the exact same CV text
-- was already analysed (keyed by SHA-256 of the normalized text).
-- Serverless analogue of an embedding cache (Groq has no embeddings model).
-- =============================================================================

create table if not exists public.cv_analysis_cache (
  text_hash  text primary key,            -- sha256 of the whitespace-normalized CV text
  profile    jsonb not null,              -- the ExtractedProfile returned by Groq
  created_at timestamptz not null default now()
);

-- Only the service-role functions touch this table.
alter table public.cv_analysis_cache enable row level security;
