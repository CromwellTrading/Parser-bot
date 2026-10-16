-- ETECSA catalog pricing configuration and provider catalog cache.
-- Run in the Supabase SQL editor before deploying this backend version.
-- The API token itself is never stored in this table; set SOKY_APP_TOKEN in Render.

create table if not exists public.synthesisone_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.synthesisone_settings (key, value, updated_at)
values ('etecsa_pricing', '{"usd_to_cup_rate": null, "usd_to_saldo_rate": null, "rounding_step_cup": 5, "rounding_step_saldo": 5, "rounding_mode": "up"}'::jsonb, now())
on conflict (key) do nothing;

-- The provider catalog is stored in the same settings table under
-- etecsa_catalog_cache. It contains verified offer metadata and source costs;
-- API clients receive only the calculated CUP and Saldo Móvil prices.

-- Settings and the cached provider costs are accessed only through the backend
-- using SUPABASE_SERVICE_KEY. Do not expose this table to mobile/anonymous clients.
alter table public.synthesisone_settings enable row level security;
revoke all on table public.synthesisone_settings from public, anon, authenticated;
grant all on table public.synthesisone_settings to service_role;
