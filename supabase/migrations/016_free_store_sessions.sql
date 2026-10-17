-- SynthesisOne SO — free access to official ETECSA and Game Market purchases.
-- Run in the SAME Supabase project used by the Render backend before deploying the new backend.
-- Safe/idempotent: adds only the two session metadata columns and indexes.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS store_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_session_secret_hash text;

-- One reusable free store session per installation. Paid-license rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS clients_store_only_device_unique_idx
  ON public.clients (device_id)
  WHERE store_only = true AND device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clients_store_only_lookup_idx
  ON public.clients (store_only, device_id)
  WHERE store_only = true;

COMMENT ON COLUMN public.clients.store_only IS
  'True only for free official-store sessions; these sessions cannot use personal webhooks or license-only features.';
COMMENT ON COLUMN public.clients.store_session_secret_hash IS
  'SHA-256 hash of the per-installation secret used to recover a free store token.';

-- Verification: existing paid clients should report store_only=false.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'clients'
  AND column_name IN ('store_only', 'store_session_secret_hash')
ORDER BY column_name;
