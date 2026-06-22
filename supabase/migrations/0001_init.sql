-- =============================================================================
-- Serverless schema for the Phosboucraa internship assistant.
-- Run in Supabase: SQL Editor -> paste -> Run (or via the Supabase CLI).
-- Auth is handled by Supabase Auth (auth.users); `profiles` adds the app role.
-- No pgvector: matching is skill + education based (skills normalised by Groq).
-- =============================================================================

-- ---- Admin profiles (1-1 with Supabase auth users) ----
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'recruiter' check (role in ('admin', 'recruiter', 'viewer')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile when a user signs up (role defaults to 'recruiter';
-- promote your admin with: update public.profiles set role='admin' where id='<uid>').
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- Skills taxonomy ----
create table if not exists public.skills (
  id bigserial primary key,
  name text not null,
  normalized text not null unique,
  category text not null default 'technical'
    check (category in ('technical', 'soft', 'language', 'domain')),
  created_at timestamptz not null default now()
);

-- ---- Departments ----
create table if not exists public.departments (
  id bigserial primary key,
  name text not null,
  code text not null unique,
  description text,
  supervisor_name text,
  supervisor_email text,
  capacity int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Candidates ----
create table if not exists public.candidates (
  id bigserial primary key,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  education_level text,
  field_of_study text,
  university text,
  years_experience numeric not null default 0,
  cv_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_candidates_email on public.candidates (email);

create table if not exists public.candidate_skills (
  id bigserial primary key,
  candidate_id bigint not null references public.candidates (id) on delete cascade,
  skill_id bigint not null references public.skills (id) on delete cascade,
  weight numeric not null default 1.0,
  unique (candidate_id, skill_id)
);
create index if not exists ix_candidate_skills_skill on public.candidate_skills (skill_id);

-- ---- Internship offers (departmental needs) ----
create table if not exists public.internship_offers (
  id bigserial primary key,
  department_id bigint not null references public.departments (id) on delete cascade,
  title text not null,
  description text,
  field text,
  slots int not null default 1,
  min_education_level text,
  status text not null default 'open' check (status in ('open', 'closed', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_offers_department on public.internship_offers (department_id);

create table if not exists public.offer_skills (
  id bigserial primary key,
  offer_id bigint not null references public.internship_offers (id) on delete cascade,
  skill_id bigint not null references public.skills (id) on delete cascade,
  weight numeric not null default 1.0,
  required boolean not null default false,
  unique (offer_id, skill_id)
);
create index if not exists ix_offer_skills_skill on public.offer_skills (skill_id);

-- ---- Applications ----
create table if not exists public.applications (
  id bigserial primary key,
  candidate_id bigint not null references public.candidates (id) on delete cascade,
  offer_id bigint references public.internship_offers (id) on delete set null,
  status text not null default 'submitted'
    check (status in ('submitted', 'parsing', 'parsed', 'under_review', 'assigned', 'rejected', 'failed')),
  motivation text,
  match_score numeric,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_applications_status on public.applications (status);
create index if not exists ix_applications_candidate on public.applications (candidate_id);
create index if not exists ix_applications_offer on public.applications (offer_id);

-- ---- Documents (files live in Supabase Storage bucket 'documents') ----
create table if not exists public.documents (
  id bigserial primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  kind text not null default 'cv' check (kind in ('cv', 'cover_letter', 'transcript', 'other')),
  filename text not null,
  storage_path text not null,
  content_type text,
  size int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ix_documents_application on public.documents (application_id);

-- ---- Matching runs + assignments ----
create table if not exists public.matching_runs (
  id bigserial primary key,
  algorithm text not null default 'hungarian',
  total_candidates int not null default 0,
  total_slots int not null default 0,
  assignments_count int not null default 0,
  average_score numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id bigserial primary key,
  application_id bigint not null unique references public.applications (id) on delete cascade,
  candidate_id bigint not null references public.candidates (id) on delete cascade,
  offer_id bigint not null references public.internship_offers (id) on delete cascade,
  matching_run_id bigint references public.matching_runs (id) on delete set null,
  match_score numeric not null default 0,
  score_breakdown jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected')),
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_assignments_candidate on public.assignments (candidate_id);
create index if not exists ix_assignments_offer on public.assignments (offer_id);

-- ---- Row Level Security ----
-- Enable RLS everywhere. The serverless functions use the SERVICE ROLE key,
-- which bypasses RLS; they enforce admin access themselves. No anon policies
-- are granted (so the public PostgREST API exposes nothing).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','skills','departments','candidates','candidate_skills',
    'internship_offers','offer_skills','applications','documents',
    'matching_runs','assignments'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Let an authenticated user read their own profile (used for the role check).
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

-- ---- Storage bucket for CVs (private) ----
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
