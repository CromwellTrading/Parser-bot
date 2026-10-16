-- ETECSA checkout tickets, payment matching and Soky recharge lifecycle.
-- Run once in the Supabase SQL editor before deploying the purchase flow.

create table if not exists public.etecsa_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  offer_id text not null,
  price_id text not null,
  offer_name text not null,
  offer_type text not null check (offer_type in ('recharge', 'nauta')),
  price_label text not null,
  price_basis text not null check (price_basis in ('CUP', 'SALDO')),
  payment_amount numeric(14,2) not null check (payment_amount > 0),
  payer_phone text not null,
  destination_card text not null,
  confirmation_phone text not null,
  status text not null default 'WAITING_PAYMENT' check (status in (
    'WAITING_PAYMENT', 'PAYMENT_RECEIVED_WAITING_DETAILS', 'SUBMITTING_TO_SOKY',
    'PROCESSING', 'COMPLETED', 'CANCELED', 'EXPIRED', 'FULFILLMENT_REVIEW', 'REFUND_REQUIRED'
  )),
  required_inputs jsonb not null default '["recipient"]'::jsonb,
  has_email boolean not null default false,
  is_preorder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payment_deadline_at timestamptz not null,
  paid_at timestamptz,
  payment_transaction_at timestamptz,
  payment_transaction_id text,
  payment_sms_log_id text,
  recipient text,
  recipient_name text,
  email text,
  submitted_at timestamptz,
  provider_recharge_id text,
  provider_status text,
  provider_reference text,
  provider_payload jsonb,
  completed_at timestamptz,
  canceled_at timestamptz,
  failure_reason text
);

create index if not exists etecsa_orders_client_created_idx
  on public.etecsa_orders (client_id, created_at desc);
create index if not exists etecsa_orders_processing_idx
  on public.etecsa_orders (status, updated_at)
  where status = 'PROCESSING';
-- Only an unpaid payment ticket blocks another checkout. Once payment is
-- matched, customers may start another purchase while fulfillment continues.
drop index if exists public.etecsa_orders_one_active_per_client_idx;
create unique index etecsa_orders_one_active_per_client_idx
  on public.etecsa_orders (client_id)
  where status = 'WAITING_PAYMENT';
create unique index if not exists etecsa_orders_payment_transaction_unique_idx
  on public.etecsa_orders (payment_transaction_id)
  where payment_transaction_id is not null and payment_transaction_id <> '';
create unique index if not exists etecsa_orders_provider_recharge_unique_idx
  on public.etecsa_orders (provider_recharge_id)
  where provider_recharge_id is not null and provider_recharge_id <> '';

create table if not exists public.etecsa_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.etecsa_orders enable row level security;
revoke all on table public.etecsa_orders from public, anon, authenticated;
grant all on table public.etecsa_orders to service_role;

alter table public.etecsa_webhook_events enable row level security;
revoke all on table public.etecsa_webhook_events from public, anon, authenticated;
grant all on table public.etecsa_webhook_events to service_role;
