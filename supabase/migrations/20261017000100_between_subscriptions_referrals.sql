-- BETWEEN subscriptions, free AI reply quota, and referrals.
-- Apply this migration in Supabase SQL Editor before deploying the updated Edge Function.

create table if not exists public.bot_entitlements (
  user_id uuid primary key references public.telegram_users(id) on delete cascade,
  free_replies_remaining integer not null default 20 check (free_replies_remaining >= 0),
  premium_replies_remaining integer not null default 0 check (premium_replies_remaining >= 0),
  premium_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_referrals (
  id bigint generated always as identity primary key,
  referrer_user_id uuid not null references public.telegram_users(id) on delete cascade,
  referred_user_id uuid not null unique references public.telegram_users(id) on delete cascade,
  qualifying_ai_replies integer not null default 0 check (qualifying_ai_replies >= 0),
  bonus_granted boolean not null default false,
  created_at timestamptz not null default now(),
  bonus_granted_at timestamptz,
  constraint bot_referrals_no_self_referral check (referrer_user_id <> referred_user_id)
);

create index if not exists bot_referrals_referrer_idx
  on public.bot_referrals(referrer_user_id);

create table if not exists public.bot_payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.telegram_users(id) on delete restrict,
  telegram_payment_charge_id text not null unique,
  provider_payment_charge_id text,
  currency text not null,
  total_amount integer not null check (total_amount > 0),
  invoice_payload text not null,
  created_at timestamptz not null default now()
);

alter table public.bot_entitlements enable row level security;
alter table public.bot_referrals enable row level security;
alter table public.bot_payments enable row level security;

create or replace function public.ensure_bot_entitlement(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.bot_entitlements(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
$$;

create or replace function public.consume_bot_ai_reply(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.bot_entitlements%rowtype;
  access_kind text;
begin
  insert into public.bot_entitlements(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into e
  from public.bot_entitlements
  where user_id = p_user_id
  for update;

  if e.premium_expires_at is not null
     and e.premium_expires_at > now()
     and e.premium_replies_remaining > 0 then
    update public.bot_entitlements
      set premium_replies_remaining = premium_replies_remaining - 1,
          updated_at = now()
      where user_id = p_user_id
      returning * into e;
    access_kind := 'premium';
  elsif e.free_replies_remaining > 0 then
    update public.bot_entitlements
      set free_replies_remaining = free_replies_remaining - 1,
          updated_at = now()
      where user_id = p_user_id
      returning * into e;
    access_kind := 'free';
  else
    return jsonb_build_object(
      'allowed', false,
      'access_type', null,
      'free_replies_remaining', e.free_replies_remaining,
      'premium_replies_remaining', e.premium_replies_remaining,
      'premium_expires_at', e.premium_expires_at
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'access_type', access_kind,
    'free_replies_remaining', e.free_replies_remaining,
    'premium_replies_remaining', e.premium_replies_remaining,
    'premium_expires_at', e.premium_expires_at
  );
end;
$$;

create or replace function public.refund_bot_ai_reply(p_user_id uuid, p_access_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_access_type = 'free' then
    update public.bot_entitlements
      set free_replies_remaining = free_replies_remaining + 1,
          updated_at = now()
      where user_id = p_user_id;
  elsif p_access_type = 'premium' then
    update public.bot_entitlements
      set premium_replies_remaining = premium_replies_remaining + 1,
          updated_at = now()
      where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.register_bot_referral(p_referrer_user_id uuid, p_referred_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  referred_entitlement public.bot_entitlements%rowtype;
begin
  if p_referrer_user_id = p_referred_user_id then
    return false;
  end if;

  if not exists (select 1 from public.telegram_users where id = p_referrer_user_id)
     or not exists (select 1 from public.telegram_users where id = p_referred_user_id) then
    return false;
  end if;

  insert into public.bot_entitlements(user_id)
  values (p_referred_user_id)
  on conflict (user_id) do nothing;

  select * into referred_entitlement
  from public.bot_entitlements
  where user_id = p_referred_user_id;

  -- Referrals are only accepted before the invitee has consumed free replies
  -- or received a premium entitlement.
  if referred_entitlement.free_replies_remaining <> 20
     or referred_entitlement.premium_replies_remaining <> 0
     or referred_entitlement.premium_expires_at is not null then
    return false;
  end if;

  insert into public.bot_referrals(referrer_user_id, referred_user_id)
  values (p_referrer_user_id, p_referred_user_id)
  on conflict (referred_user_id) do nothing;

  return found;
end;
$$;

create or replace function public.record_bot_referral_ai_reply(p_referred_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.bot_referrals%rowtype;
  next_count integer;
begin
  select * into r
  from public.bot_referrals
  where referred_user_id = p_referred_user_id
  for update;

  if not found or r.bonus_granted then
    return jsonb_build_object('bonus_granted', false);
  end if;

  next_count := least(r.qualifying_ai_replies + 1, 5);

  update public.bot_referrals
    set qualifying_ai_replies = next_count
    where id = r.id;

  if next_count < 5 then
    return jsonb_build_object('bonus_granted', false, 'qualifying_ai_replies', next_count);
  end if;

  update public.bot_referrals
    set bonus_granted = true,
        bonus_granted_at = now()
    where id = r.id;

  insert into public.bot_entitlements(user_id)
  values (r.referrer_user_id)
  on conflict (user_id) do nothing;

  update public.bot_entitlements
    set premium_expires_at = greatest(coalesce(premium_expires_at, now()), now()) + interval '7 days',
        premium_replies_remaining = premium_replies_remaining + 70,
        updated_at = now()
    where user_id = r.referrer_user_id;

  return jsonb_build_object(
    'bonus_granted', true,
    'referrer_user_id', r.referrer_user_id,
    'bonus_days', 7,
    'bonus_replies', 70
  );
end;
$$;

create or replace function public.process_bot_stars_payment(
  p_user_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,
  p_currency text,
  p_total_amount integer,
  p_invoice_payload text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_payment_id bigint;
begin
  if p_currency <> 'XTR' or p_total_amount <= 0 then
    raise exception 'Invalid Telegram Stars payment details';
  end if;

  insert into public.bot_payments(
    user_id, telegram_payment_charge_id, provider_payment_charge_id,
    currency, total_amount, invoice_payload
  )
  values (
    p_user_id, p_telegram_payment_charge_id, p_provider_payment_charge_id,
    p_currency, p_total_amount, p_invoice_payload
  )
  on conflict (telegram_payment_charge_id) do nothing
  returning id into inserted_payment_id;

  if inserted_payment_id is null then
    return jsonb_build_object('processed', false, 'reason', 'duplicate');
  end if;

  insert into public.bot_entitlements(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.bot_entitlements
    set premium_expires_at = greatest(coalesce(premium_expires_at, now()), now()) + interval '30 days',
        premium_replies_remaining = premium_replies_remaining + 300,
        updated_at = now()
    where user_id = p_user_id;

  return jsonb_build_object('processed', true, 'premium_days', 30, 'premium_replies', 300);
end;
$$;

revoke all on function public.ensure_bot_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.consume_bot_ai_reply(uuid) from public, anon, authenticated;
revoke all on function public.refund_bot_ai_reply(uuid, text) from public, anon, authenticated;
revoke all on function public.register_bot_referral(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_bot_referral_ai_reply(uuid) from public, anon, authenticated;
revoke all on function public.process_bot_stars_payment(uuid, text, text, text, integer, text) from public, anon, authenticated;

grant execute on function public.ensure_bot_entitlement(uuid) to service_role;
grant execute on function public.consume_bot_ai_reply(uuid) to service_role;
grant execute on function public.refund_bot_ai_reply(uuid, text) to service_role;
grant execute on function public.register_bot_referral(uuid, uuid) to service_role;
grant execute on function public.record_bot_referral_ai_reply(uuid) to service_role;
grant execute on function public.process_bot_stars_payment(uuid, text, text, text, integer, text) to service_role;
