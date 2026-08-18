-- =============================================================================
-- Persistance des conversations de l'assistant.
--
-- Une conversation appartient à l'utilisateur qui l'a ouverte : on ne retrouve
-- jamais le fil de quelqu'un d'autre. Les fonctions serverless écrivent avec la
-- clé service role et filtrent elles-mêmes sur user_id ; RLS reste activé sans
-- aucune police anonyme, comme partout ailleurs dans ce schéma.
-- =============================================================================

create table if not exists public.assistant_conversations (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Reprise des premiers mots de la première question, pour la liste des fils.
  title text not null default 'Nouvelle conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_assistant_conversations_user
  on public.assistant_conversations (user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id bigserial primary key,
  conversation_id bigint not null
    references public.assistant_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Outils appelés et preuves affichées, pour réafficher un tour à l'identique.
  tools jsonb,
  sources jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_assistant_messages_conversation
  on public.assistant_messages (conversation_id, id);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

-- Remonte la date du fil à chaque message, pour trier « le plus récent ».
create or replace function public.touch_assistant_conversation()
returns trigger language plpgsql as $$
begin
  update public.assistant_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_assistant_conversation on public.assistant_messages;
create trigger trg_touch_assistant_conversation
  after insert on public.assistant_messages
  for each row execute function public.touch_assistant_conversation();
