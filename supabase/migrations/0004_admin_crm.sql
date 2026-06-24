-- Admin CRM: account activation flag + internal notes on candidates.

-- Block a user's access without deleting the account (enforced in functions + Auth ban).
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- Private admin notes on a candidate (the "relationship" part of the CRM).
alter table public.candidates
  add column if not exists notes text;
