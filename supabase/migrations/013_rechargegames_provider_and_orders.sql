-- RechargeGames provider catalog, local payment tickets and fulfillment lifecycle.
-- Run this migration in Supabase before deploying the new backend.

ALTER TABLE public.game_market_games
  ADD COLUMN IF NOT EXISTS provider_game_slug text;

ALTER TABLE public.game_market_offers
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_product_key text,
  ADD COLUMN IF NOT EXISTS provider_product_name text,
  ADD COLUMN IF NOT EXISTS provider_game_slug text,
  ADD COLUMN IF NOT EXISTS provider_region_slug text,
  ADD COLUMN IF NOT EXISTS provider_region_name text,
  ADD COLUMN IF NOT EXISTS provider_delivery text,
  ADD COLUMN IF NOT EXISTS provider_out_of_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_last_seen_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS game_market_provider_product_unique_idx
  ON public.game_market_offers (store_id, provider, provider_product_key);
CREATE INDEX IF NOT EXISTS game_market_provider_offers_idx
  ON public.game_market_offers (store_id, provider, provider_game_slug, provider_region_slug);

CREATE TABLE IF NOT EXISTS public.rechargegames_catalog_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  game_count integer NOT NULL DEFAULT 0,
  product_count integer NOT NULL DEFAULT 0,
  available_product_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_recharge_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.game_market_offers(id) ON DELETE RESTRICT,
  game_name text NOT NULL,
  offer_title text NOT NULL,
  provider_product_key text NOT NULL,
  provider_product_name text NOT NULL,
  provider_game_slug text NOT NULL,
  provider_region_slug text,
  provider_region_name text,
  provider_delivery text NOT NULL CHECK (provider_delivery IN ('player_id','code')),
  provider_kind text NOT NULL DEFAULT 'topup',
  provider_cost_usdt numeric(14,4) NOT NULL CHECK (provider_cost_usdt >= 0),
  price_basis text NOT NULL CHECK (price_basis IN ('CUP','SALDO')),
  payment_amount numeric(14,2) NOT NULL CHECK (payment_amount > 0),
  payer_phone text NOT NULL,
  destination_card text NOT NULL,
  confirmation_phone text NOT NULL,
  status text NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK (status IN (
    'WAITING_PAYMENT','PAYMENT_RECEIVED_WAITING_DETAILS','SUBMITTING_TO_PROVIDER',
    'PROCESSING','COMPLETED','CANCELED','EXPIRED','FULFILLMENT_REVIEW','REFUND_REQUIRED'
  )),
  buyer_ref text NOT NULL UNIQUE,
  player_id text,
  server_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payment_deadline_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_transaction_at timestamptz,
  payment_transaction_id text,
  payment_sms_log_id text,
  provider_order_id text,
  provider_status text,
  provider_delivery_note text,
  provider_failure_reason text,
  provider_payload jsonb,
  webhook_event_id text,
  submitted_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  failure_reason text
);

CREATE INDEX IF NOT EXISTS game_recharge_orders_client_created_idx
  ON public.game_recharge_orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS game_recharge_orders_processing_idx
  ON public.game_recharge_orders (status, updated_at)
  WHERE status = 'PROCESSING';
CREATE UNIQUE INDEX IF NOT EXISTS game_recharge_orders_one_active_per_client_idx
  ON public.game_recharge_orders (client_id)
  WHERE status = 'WAITING_PAYMENT';
CREATE UNIQUE INDEX IF NOT EXISTS game_recharge_orders_payment_transaction_unique_idx
  ON public.game_recharge_orders (payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL AND payment_transaction_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS game_recharge_orders_provider_order_unique_idx
  ON public.game_recharge_orders (provider_order_id)
  WHERE provider_order_id IS NOT NULL AND provider_order_id <> '';

CREATE TABLE IF NOT EXISTS public.rechargegames_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rechargegames_catalog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rechargegames_catalog_state FROM public, anon, authenticated;
GRANT ALL ON TABLE public.rechargegames_catalog_state TO service_role;
ALTER TABLE public.game_recharge_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_recharge_orders FROM public, anon, authenticated;
GRANT ALL ON TABLE public.game_recharge_orders TO service_role;
ALTER TABLE public.rechargegames_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rechargegames_webhook_events FROM public, anon, authenticated;
GRANT ALL ON TABLE public.rechargegames_webhook_events TO service_role;

COMMENT ON TABLE public.game_recharge_orders IS 'SynthesisOne customer payment tickets and RechargeGames fulfillment lifecycle.';
COMMENT ON TABLE public.rechargegames_webhook_events IS 'Deduplication log for signed RechargeGames provider webhooks.';
