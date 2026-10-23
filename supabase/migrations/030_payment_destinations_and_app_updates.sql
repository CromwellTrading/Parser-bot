-- SynthesisOne: administrator-owned payment destinations and private APK storage.
-- Execute in the Supabase project already used by SynthesisOne before deployment.

create table if not exists public.admin_payment_destinations (
  id uuid primary key default gen_random_uuid(),
  admin_client_id uuid not null unique references public.clients(id) on delete cascade,
  label text not null default 'Cuenta de transferencia',
  card_number text not null default '',
  confirmation_phone text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_payment_destinations_card_format check (card_number = '' or card_number ~ '^[0-9]{8,24}$'),
  constraint admin_payment_destinations_phone_format check (confirmation_phone = '' or confirmation_phone ~ '^5[0-9]{7}$'),
  constraint admin_payment_destinations_active_pair check (not enabled or (card_number <> '' and confirmation_phone <> ''))
);

alter table public.license_activation_sessions add column if not exists destination_card text;
alter table public.license_activation_sessions add column if not exists confirmation_phone text;
alter table public.license_activation_sessions add column if not exists payment_destination_id text;

create index if not exists idx_admin_payment_destinations_enabled
  on public.admin_payment_destinations (enabled, created_at);

alter table public.admin_payment_destinations enable row level security;
-- Intentionally no client-facing RLS policy. Only the backend service-role key may access this table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('synthesisone-app-updates', 'synthesisone-app-updates', false, 83886080, array['application/vnd.android.package-archive', 'application/octet-stream'])
on conflict (id) do update set
  public = false,
  file_size_limit = 83886080,
  allowed_mime_types = array['application/vnd.android.package-archive', 'application/octet-stream'];

-- Release metadata is stored as the existing synthesisone_settings key app_latest_release.
-- The APK itself lives in the private Storage bucket; it is never stored in a table row.
