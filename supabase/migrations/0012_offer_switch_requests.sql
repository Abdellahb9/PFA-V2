-- =============================================================================
-- Échange d'offre à l'initiative du candidat.
--
-- Le candidat demande à passer de son offre actuelle à une autre, en joignant
-- une image prouvant l'accord de l'autre partie. Un membre du personnel tranche.
--
-- L'offre actuelle d'un candidat vit dans `assignments.offer_id` (affectation
-- confirmée), PAS dans `applications.offer_id` — cette dernière n'enregistre que
-- l'offre visée au dépôt et vaut souvent NULL (candidature générale).
-- L'approbation met les deux à jour : l'affectation parce qu'elle fait foi,
-- la candidature pour que l'espace candidat affiche la bonne offre.
--
-- RLS activée, aucune police anon : seules les fonctions serverless (clé service
-- role) accèdent à ces tables, comme partout ailleurs dans ce schéma.
-- =============================================================================

-- ---------------------------------------------------------------- Demandes
create table if not exists public.offer_switch_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id bigint not null references public.candidates (id) on delete cascade,
  -- Porte la candidature dont l'affectation confirmée sera déplacée.
  application_id bigint references public.applications (id) on delete cascade,
  current_offer_id bigint not null references public.internship_offers (id) on delete restrict,
  requested_offer_id bigint not null references public.internship_offers (id) on delete restrict,
  proof_image_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un échange vers l'offre déjà occupée n'a pas de sens.
  constraint offer_switch_distinct_offers check (current_offer_id <> requested_offer_id)
);

create index if not exists ix_switch_requests_status
  on public.offer_switch_requests (status, created_at desc);
create index if not exists ix_switch_requests_candidate
  on public.offer_switch_requests (candidate_id, created_at desc);

-- Une seule demande en attente par candidat : sans quoi deux approbations
-- successives déplaceraient deux fois la même affectation.
create unique index if not exists ux_switch_requests_one_pending
  on public.offer_switch_requests (candidate_id)
  where status = 'pending';

-- ----------------------------------------------------------- Notifications
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ix_notifications_user
  on public.notifications (user_id, read, created_at desc);

alter table public.offer_switch_requests enable row level security;
alter table public.notifications enable row level security;

-- ------------------------------------------------------------ updated_at
create or replace function public.touch_offer_switch_request()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_offer_switch_request on public.offer_switch_requests;
create trigger trg_touch_offer_switch_request
  before update on public.offer_switch_requests
  for each row execute function public.touch_offer_switch_request();

-- =============================================================================
-- Approbation atomique.
--
-- supabase-js ne sait pas enchaîner plusieurs instructions dans une transaction :
-- une approbation à moitié appliquée laisserait l'affectation déplacée sans que
-- la demande soit close, ou l'inverse. Tout se fait donc ici, en un appel.
--
-- Le score est recalculé côté handler (TypeScript, avec compositeScore) puis
-- passé en paramètre : il se rapporterait sinon à l'ancienne offre.
-- =============================================================================
create or replace function public.approve_offer_switch(
  p_request_id uuid,
  p_reviewer text,
  p_new_score numeric default 0,
  p_new_breakdown jsonb default null
)
returns public.offer_switch_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.offer_switch_requests;
  target public.internship_offers;
  used int;
  cand_user uuid;
  target_title text;
  updated public.offer_switch_requests;
begin
  -- Verrouille la demande : deux approbations simultanées se sérialisent.
  select * into req from public.offer_switch_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if req.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  -- Verrouille l'offre cible AVANT de compter ses places occupées, sinon deux
  -- approbations concurrentes pourraient la remplir au-delà de sa capacité.
  select * into target from public.internship_offers
   where id = req.requested_offer_id for update;
  if not found then
    raise exception 'OFFER_NOT_FOUND';
  end if;
  if target.status <> 'open' then
    raise exception 'OFFER_CLOSED';
  end if;

  select count(*) into used from public.assignments
   where offer_id = target.id and status = 'confirmed';
  if used >= target.slots then
    raise exception 'OFFER_FULL';
  end if;

  -- 1) L'affectation confirmée : l'enregistrement qui fait foi.
  update public.assignments
     set offer_id = target.id,
         match_score = p_new_score,
         score_breakdown = coalesce(p_new_breakdown, score_breakdown),
         decided_by = p_reviewer,
         updated_at = now()
   where application_id = req.application_id
     and status = 'confirmed';
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- 2) La candidature : l'espace candidat lit l'offre depuis elle.
  update public.applications
     set offer_id = target.id,
         updated_at = now()
   where id = req.application_id;

  -- 3) La demande.
  update public.offer_switch_requests
     set status = 'approved',
         reviewed_by = p_reviewer,
         reviewed_at = now()
   where id = req.id
  returning * into updated;

  -- 4) Notification du candidat (si son compte est rattaché).
  select user_id into cand_user from public.candidates where id = req.candidate_id;
  target_title := target.title;
  if cand_user is not null then
    insert into public.notifications (user_id, type, title, body)
    values (
      cand_user,
      'offer_switch_approved',
      'Votre échange d''offre est approuvé',
      'Vous êtes désormais affecté à « ' || target_title || ' ».'
    );
  end if;

  -- 5) Trace dans le fil visible par le candidat.
  insert into public.application_events (application_id, status, note)
  values (
    req.application_id,
    'assigned',
    'Échange d''offre approuvé — nouvelle offre : ' || target_title
  );

  return updated;
end;
$$;

-- Service-role uniquement (les fonctions imposent elles-mêmes l'auth staff).
revoke all on function public.approve_offer_switch(uuid, text, numeric, jsonb)
  from public, anon, authenticated;
