-- =============================================================================
-- Candidate portal: optional candidate accounts + application status timeline.
-- Run after 0001_init.sql and 0002_seed.sql.
-- =============================================================================

-- Link a candidate to their (optional) Supabase Auth account.
alter table public.candidates
  add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists ix_candidates_user on public.candidates (user_id);

-- Allow the 'candidate' role and make it the SAFE default for self sign-ups.
-- (Previously new users defaulted to 'recruiter' = admin access — security fix.)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'recruiter', 'viewer', 'candidate'));
alter table public.profiles alter column role set default 'candidate';

-- On sign-up: create the profile (default = candidate) AND link any existing
-- (anonymous) applications submitted with the same email to this new account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;

  update public.candidates
     set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;

  return new;
end;
$$;

-- Status history shown to the candidate as a timeline.
create table if not exists public.application_events (
  id bigserial primary key,
  application_id bigint not null references public.applications (id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ix_application_events_app on public.application_events (application_id);
alter table public.application_events enable row level security;

-- Auto-log every status change (and the initial submission) for the timeline.
create or replace function public.log_application_status()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') or (new.status is distinct from old.status) then
    insert into public.application_events (application_id, status) values (new.id, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_application_status on public.applications;
create trigger trg_log_application_status
  after insert or update of status on public.applications
  for each row execute function public.log_application_status();

-- Backfill an initial event for applications that predate this migration.
insert into public.application_events (application_id, status, created_at)
select a.id, a.status, a.created_at
from public.applications a
where not exists (select 1 from public.application_events e where e.application_id = a.id);
