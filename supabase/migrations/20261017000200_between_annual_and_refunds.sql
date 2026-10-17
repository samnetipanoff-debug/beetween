-- Extend BETWEEN Plus with monthly/yearly plans and auditable refund requests.
-- Apply after 20261017000100_between_subscriptions_referrals.sql and before deploying the matching Edge Function.

alter table public.bot_entitlements
  add column if not exists plan_type text,
  add column if not exists premium_quota_reset_at timestamptz,
  add column if not exists premium_replies_used_since_purchase integer not null default 0
    check (premium_replies_used_since_purchase >= 0);

alter table public.bot_payments
  add column if not exists plan_type text not null default 'monthly',
  add column if not exists term_days integer not null default 30,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_requested_at timestamptz;

create table if not exists public.bot_refund_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.telegram_users(id) on delete restrict,
  payment_id bigint not null references public.bot_payments(id) on delete restrict,
  request_type text not null check (request_type in ('full_refund_review', 'access_cancellation')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed')),
  user_message text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

create unique index if not exists bot_refund_requests_one_pending_per_payment
  on public.bot_refund_requests(payment_id)
  where status = 'pending';

alter table public.bot_refund_requests enable row level security;

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

  -- Refresh a paid quota every 30 days while premium access remains active.
  if e.premium_expires_at is not null
     and e.premium_expires_at > now()
     and e.premium_quota_reset_at is not null
     and e.premium_quota_reset_at <= now() then
    update public.bot_entitlements
      set premium_replies_remaining = 300,
          premium_replies_used_since_purchase = 0,
          premium_quota_reset_at = now() + interval '30 days',
          updated_at = now()
      where user_id = p_user_id
      returning * into e;
  end if;

  if e.premium_expires_at is not null
     and e.premium_expires_at > now()
     and e.premium_replies_remaining > 0 then
    update public.bot_entitlements
      set premium_replies_remaining = premium_replies_remaining - 1,
          premium_replies_used_since_purchase = premium_replies_used_since_purchase + 1,
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
      'premium_expires_at', e.premium_expires_at,
      'plan_type', e.plan_type
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'access_type', access_kind,
    'free_replies_remaining', e.free_replies_remaining,
    'premium_replies_remaining', e.premium_replies_remaining,
    'premium_expires_at', e.premium_expires_at,
    'plan_type', e.plan_type
  );
end;
$$;

create or replace function public.process_bot_stars_payment_v2(
  p_user_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,
  p_currency text,
  p_total_amount integer,
  p_invoice_payload text,
  p_plan_type text,
  p_term_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_payment_id bigint;
  new_expiry timestamptz;
begin
  if p_currency <> 'XTR' or p_total_amount <= 0 then
    raise exception 'Invalid Telegram Stars payment details';
  end if;
  if p_plan_type not in ('monthly', 'yearly') then
    raise exception 'Invalid subscription plan';
  end if;
  if (p_plan_type = 'monthly' and (p_total_amount <> 990 or p_term_days <> 30))
     or (p_plan_type = 'yearly' and (p_total_amount <> 5590 or p_term_days <> 365)) then
    raise exception 'Payment does not match the configured plan';
  end if;

  insert into public.bot_payments(
    user_id, telegram_payment_charge_id, provider_payment_charge_id,
    currency, total_amount, invoice_payload, plan_type, term_days
  )
  values (
    p_user_id, p_telegram_payment_charge_id, p_provider_payment_charge_id,
    p_currency, p_total_amount, p_invoice_payload, p_plan_type, p_term_days
  )
  on conflict (telegram_payment_charge_id) do nothing
  returning id into inserted_payment_id;

  if inserted_payment_id is null then
    return jsonb_build_object('processed', false, 'reason', 'duplicate');
  end if;

  insert into public.bot_entitlements(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select greatest(coalesce(premium_expires_at, now()), now()) + make_interval(days => p_term_days)
    into new_expiry
  from public.bot_entitlements
  where user_id = p_user_id
  for update;

  update public.bot_entitlements
    set premium_expires_at = new_expiry,
        premium_replies_remaining = case
          when premium_expires_at is not null and premium_expires_at > now()
            then premium_replies_remaining
          else 300
        end,
        plan_type = p_plan_type,
        premium_quota_reset_at = case
          when p_plan_type = 'yearly' then now() + interval '30 days'
          else new_expiry
        end,
        premium_replies_used_since_purchase = 0,
        updated_at = now()
    where user_id = p_user_id;

  return jsonb_build_object(
    'processed', true,
    'premium_days', p_term_days,
    'premium_replies', 300,
    'plan_type', p_plan_type
  );
end;
$$;

create or replace function public.request_bot_refund_review(
  p_user_id uuid,
  p_request_type text,
  p_user_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.bot_payments%rowtype;
  new_request_id bigint;
begin
  if p_request_type not in ('full_refund_review', 'access_cancellation') then
    raise exception 'Invalid request type';
  end if;

  select * into p
  from public.bot_payments
  where user_id = p_user_id
    and refunded_at is null
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('created', false, 'reason', 'no_refundable_payment');
  end if;

  if exists (
    select 1 from public.bot_refund_requests
    where payment_id = p.id and status = 'pending'
  ) then
    return jsonb_build_object('created', false, 'reason', 'already_pending');
  end if;

  insert into public.bot_refund_requests(user_id, payment_id, request_type, user_message)
  values (p_user_id, p.id, p_request_type, p_user_message)
  returning id into new_request_id;

  update public.bot_payments
    set refund_requested_at = now()
    where id = p.id;

  return jsonb_build_object(
    'created', true,
    'request_id', new_request_id,
    'payment_id', p.id,
    'plan_type', p.plan_type,
    'total_amount', p.total_amount,
    'term_days', p.term_days,
    'refunded_at', p.refunded_at
  );
end;
$$;

revoke all on function public.process_bot_stars_payment_v2(uuid, text, text, text, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.request_bot_refund_review(uuid, text, text) from public, anon, authenticated;
grant execute on function public.process_bot_stars_payment_v2(uuid, text, text, text, integer, text, text, integer) to service_role;
grant execute on function public.request_bot_refund_review(uuid, text, text) to service_role;
