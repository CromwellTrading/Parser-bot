-- SynthesisOne: prevent more than one active client per phone.
-- Run only after confirming that existing active duplicates have been reconciled.
-- The application also performs the check server-side during onboarding/reinstall.

create unique index if not exists clients_one_active_per_phone_idx
  on public.clients (phone_number)
  where active = true and role = 'client' and phone_number is not null;
