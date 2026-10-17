-- Offer a user-controlled pause after a long exchange, at most once per session.
-- This is a suggestion only: it does not block messages or send reminders.

create table if not exists public.bot_session_pause_offers (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  user_id uuid not null references public.telegram_users(id) on delete cascade,
  offered_at timestamptz not null default now(),
  choice text check (choice in ('continue', 'pause'))
);

create index if not exists bot_session_pause_offers_user_id_idx
  on public.bot_session_pause_offers(user_id);

alter table public.bot_session_pause_offers enable row level security;

drop policy if exists "service role manages session pause offers" on public.bot_session_pause_offers;
create policy "service role manages session pause offers"
  on public.bot_session_pause_offers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
