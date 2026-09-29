-- SynthesisOne: enforce license expiration at the database level for existing rows.
-- Run this once before/with backend v2.0 deployment.
-- It does NOT delete clients; it blocks expired access and preserves history.

create index if not exists clients_active_expires_idx
  on public.clients (expires_at)
  where active = true and role = 'client' and expires_at is not null;

-- One-time cleanup of clients that are already expired but still marked active.
with expired as (
  select id, token
  from public.clients
  where role = 'client'
    and active = true
    and expires_at is not null
    and expires_at <= now()
)
insert into public.token_blacklist (token, client_id, reason, invalidated_at)
select token, id, 'LICENSE_EXPIRED', now()
from expired
where token is not null
on conflict (token) do nothing;

update public.clients c
set active = false
where c.role = 'client'
  and c.active = true
  and c.expires_at is not null
  and c.expires_at <= now();

-- Audit query: returns any expired client that would still be active.
-- Expected result after the migration: zero rows.
-- select id, name, phone_number, active, expires_at
-- from public.clients
-- where role = 'client'
--   and active = true
--   and expires_at is not null
--   and expires_at <= now();
