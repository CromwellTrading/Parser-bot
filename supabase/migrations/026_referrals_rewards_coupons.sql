-- SynthesisOne: referral rewards, missions, CUP-only coupons and checkout discount metadata.
-- Apply to the SAME Supabase project used by the production backend before deploying.

CREATE TABLE IF NOT EXISTS public.reward_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  referral_code text NOT NULL UNIQUE,
  device_id text,
  referred_by_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  referred_by_code text,
  referral_bound_at timestamptz,
  first_paid_purchase_at timestamptz,
  first_cup_purchase_at timestamptz,
  welcome_started_at timestamptz NOT NULL DEFAULT now(),
  welcome_used_at timestamptz,
  welcome_reserved_order_ref text,
  welcome_reserved_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_profiles_not_self_referred CHECK (referred_by_client_id IS NULL OR referred_by_client_id <> client_id)
);
CREATE INDEX IF NOT EXISTS reward_profiles_referrer_idx ON public.reward_profiles (referred_by_client_id);
CREATE INDEX IF NOT EXISTS reward_profiles_device_idx ON public.reward_profiles (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reward_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referred_client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  referrer_device_id text,
  referred_device_id text,
  status text NOT NULL DEFAULT 'QUALIFIED' CHECK (status IN ('QUALIFIED','REVOKED')),
  qualified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_referrals_different_clients CHECK (referrer_client_id <> referred_client_id),
  CONSTRAINT reward_referrals_different_devices CHECK (referrer_device_id IS NULL OR referred_device_id IS NULL OR referrer_device_id <> referred_device_id)
);
CREATE INDEX IF NOT EXISTS reward_referrals_referrer_status_idx ON public.reward_referrals (referrer_client_id, status, qualified_at DESC);

CREATE TABLE IF NOT EXISTS public.reward_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coupon_code text NOT NULL UNIQUE,
  source text NOT NULL,
  source_key text NOT NULL,
  discount_percent numeric(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  minimum_subtotal_cup numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_subtotal_cup >= 0),
  minimum_exclusive boolean NOT NULL DEFAULT false,
  applies_to text NOT NULL DEFAULT 'CUP' CHECK (applies_to = 'CUP'),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','USED','REVOKED','EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  reserved_order_ref text,
  reserved_until timestamptz,
  used_order_ref text,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, source_key)
);
CREATE INDEX IF NOT EXISTS reward_coupons_client_status_idx ON public.reward_coupons (client_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS reward_coupons_reservation_idx ON public.reward_coupons (reserved_until) WHERE status = 'RESERVED';

CREATE TABLE IF NOT EXISTS public.reward_purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('GAME_MARKET','ETECSA')),
  source_order_id text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('CUP','SALDO')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  base_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  item_count integer NOT NULL DEFAULT 1 CHECK (item_count >= 1),
  has_game_market boolean NOT NULL DEFAULT false,
  has_etecsa boolean NOT NULL DEFAULT false,
  paid_at timestamptz NOT NULL DEFAULT now(),
  event_status text NOT NULL DEFAULT 'VALID' CHECK (event_status IN ('VALID','REVERSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_order_id)
);
UPDATE public.reward_purchase_events SET has_game_market = (source = 'GAME_MARKET'), has_etecsa = (source = 'ETECSA') WHERE NOT has_game_market AND NOT has_etecsa;
CREATE INDEX IF NOT EXISTS reward_purchase_events_client_paid_idx ON public.reward_purchase_events (client_id, paid_at DESC) WHERE event_status = 'VALID';
CREATE INDEX IF NOT EXISTS reward_purchase_events_mission_idx ON public.reward_purchase_events (currency, paid_at DESC, amount) WHERE event_status = 'VALID';

-- Time-limited, admin-configurable missions used by the "Misión relámpago" task.
CREATE TABLE IF NOT EXISTS public.reward_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  minimum_purchase_cup numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_purchase_cup >= 0),
  required_purchases integer NOT NULL DEFAULT 1 CHECK (required_purchases >= 1 AND required_purchases <= 100),
  reward_percent numeric(5,2) NOT NULL CHECK (reward_percent > 0 AND reward_percent <= 100),
  reward_minimum_subtotal_cup numeric(14,2) NOT NULL DEFAULT 0 CHECK (reward_minimum_subtotal_cup >= 0),
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS reward_campaigns_active_period_idx ON public.reward_campaigns (active, starts_at, ends_at);

-- Keep discount provenance on the existing order rows; payment-ticket schemas and flows remain intact.
ALTER TABLE public.game_recharge_orders
  ADD COLUMN IF NOT EXISTS reward_base_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS reward_discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS reward_discount_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS reward_coupon_id uuid REFERENCES public.reward_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS welcome_discount boolean NOT NULL DEFAULT false;

ALTER TABLE public.etecsa_orders
  ADD COLUMN IF NOT EXISTS reward_base_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS reward_discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS reward_discount_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS reward_coupon_id uuid REFERENCES public.reward_coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS welcome_discount boolean NOT NULL DEFAULT false;

-- This feature is server-authoritative. The Android client cannot read/write the tables directly.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reward_profiles','reward_referrals','reward_coupons','reward_purchase_events','reward_campaigns'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.reward_profiles IS 'Server-authoritative client reward profile, referral identity and one-time welcome discount.';
COMMENT ON TABLE public.reward_coupons IS 'Single-use CUP-only discount coupons earned from referrals, missions and campaigns.';
COMMENT ON TABLE public.reward_purchase_events IS 'Idempotent ledger of payment-verified customer purchases used for reward qualification.';
COMMENT ON TABLE public.reward_campaigns IS 'Admin-managed time-limited purchase missions and coupon rewards.';
