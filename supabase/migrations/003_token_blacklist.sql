-- SynthesisOne: authoritative token revocation registry.
-- Run after 001_license_auto_activation.sql and 002_activation_payment_window.sql.

create table if not exists public.token_blacklist (
  token text primary key,
  client_id text,
  invalidated_at timestamptz not null default now(),
  reason text
);

alter table public.token_blacklist
  add column if not exists client_id text,
  add column if not exists invalidated_at timestamptz not null default now(),
  add column if not exists reason text;

create index if not exists idx_token_blacklist_client_id
  on public.token_blacklist (client_id);

create index if not exists idx_token_blacklist_invalidated_at
  on public.token_blacklist (invalidated_at desc);

comment on table public.token_blacklist is 'Tokens permanently or temporarily invalidated by the administration. Every token validation route must consult this table.';
comment on column public.token_blacklist.reason is 'SUSPENDED_BY_ADMIN, TOKEN_RENEWED, CLIENT_DELETED, or another administrative reason.';
