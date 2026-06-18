-- =============================================================================
-- Database bootstrap executed once by the Postgres container on first start.
-- Enables the pgvector extension used for semantic CV/offer matching.
-- (On Supabase, enable "vector" from Database > Extensions instead.)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
