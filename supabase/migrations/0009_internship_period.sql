-- =============================================================================
-- Internship period: the candidate states WHEN they want to start and for HOW
-- LONG when applying. Once an assignment is confirmed, that period is what
-- books the offer slot — the "Offres réservées" page reads it back.
--
-- end_date is derived from start_date + duration_months. It is kept by a
-- trigger rather than a GENERATED column so the expression stays free of
-- immutability constraints, and it can never drift from its two inputs.
-- =============================================================================

alter table public.applications
  add column if not exists start_date date,
  add column if not exists duration_months int,
  add column if not exists end_date date;

-- Guard the range (1–12 months) without breaking rows that predate the column.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_duration_months_check'
  ) then
    alter table public.applications
      add constraint applications_duration_months_check
      check (duration_months is null or duration_months between 1 and 12);
  end if;
end $$;

create or replace function public.applications_set_end_date()
returns trigger language plpgsql as $$
begin
  new.end_date := case
    when new.start_date is null or new.duration_months is null then null
    else (new.start_date + make_interval(months => new.duration_months))::date
  end;
  return new;
end;
$$;

drop trigger if exists trg_applications_end_date on public.applications;
create trigger trg_applications_end_date
  before insert or update of start_date, duration_months on public.applications
  for each row execute function public.applications_set_end_date();

-- Backfill any row that already carries both inputs.
update public.applications
   set duration_months = duration_months
 where start_date is not null
   and duration_months is not null
   and end_date is null;

-- The bookings page filters on the period and orders by its start.
create index if not exists ix_applications_period
  on public.applications (start_date, end_date);
