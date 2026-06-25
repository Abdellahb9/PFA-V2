-- =============================================================================
-- Security hardening — resolves the Supabase database linter WARNINGs on the
-- functions created in 0003. Safe to run multiple times.
-- =============================================================================

-- 1) Pin search_path on the status-logging trigger function (was "mutable").
--    Body fully-qualifies its tables, so an empty search_path is safe.
create or replace function public.log_application_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT') or (new.status is distinct from old.status) then
    insert into public.application_events (application_id, status)
    values (new.id, new.status);
  end if;
  return new;
end;
$$;

-- 2) handle_new_user(): must stay SECURITY DEFINER (it writes profiles/candidates
--    on sign-up), but pin its search_path explicitly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

-- 3) These are TRIGGER functions: their triggers still fire after this (Postgres
--    does not check EXECUTE for trigger invocation), but they should NOT be
--    callable directly via the PostgREST API (/rest/v1/rpc/...). Remove the
--    default PUBLIC grant so anon/authenticated can no longer execute them.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_application_status() from public, anon, authenticated;
