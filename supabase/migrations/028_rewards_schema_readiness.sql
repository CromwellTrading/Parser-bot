-- SynthesisOne: explicit completion marker for the rewards/cart migrations.
-- Apply only after 026_referrals_rewards_coupons.sql and 027_store_cart_orders.sql.
-- This marker is written only after the required objects are verified. The backend
-- keeps rewards/cart opt-in and uses this row to fail closed on partial deployments.

CREATE TABLE IF NOT EXISTS public.reward_schema_status (
  id text PRIMARY KEY CHECK (id = 'rewards-v1'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reward_schema_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_profiles ADD COLUMN IF NOT EXISTS purchase_history_checked_at timestamptz;
REVOKE ALL ON TABLE public.reward_schema_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.reward_schema_status TO service_role;

DO $$
BEGIN
  IF to_regclass('public.reward_profiles') IS NULL OR
     to_regclass('public.reward_referrals') IS NULL OR
     to_regclass('public.reward_coupons') IS NULL OR
     to_regclass('public.reward_purchase_events') IS NULL OR
     to_regclass('public.reward_campaigns') IS NULL OR
     to_regclass('public.store_cart_orders') IS NULL OR
     to_regclass('public.store_cart_items') IS NULL OR
     to_regclass('public.store_cart_schema_status') IS NULL OR
     to_regclass('public.store_payment_transaction_claims') IS NULL THEN
    RAISE EXCEPTION 'SYNTHESIS_REWARDS_MIGRATIONS_INCOMPLETE: apply migrations 026 and 027 first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reward_profiles' AND column_name='welcome_started_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reward_profiles' AND column_name='purchase_history_checked_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reward_profiles' AND column_name='referred_by_client_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reward_coupons' AND column_name='minimum_exclusive'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reward_purchase_events' AND column_name='has_game_market'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='game_recharge_orders' AND column_name='store_cart_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='etecsa_orders' AND column_name='store_cart_id'
  ) THEN
    RAISE EXCEPTION 'SYNTHESIS_REWARDS_COLUMNS_INCOMPLETE: recheck migration 026 and 027';
  END IF;

  IF to_regprocedure('public.store_wallet_create_cart_order(uuid,numeric,text,jsonb,jsonb,text)') IS NULL OR
     to_regprocedure('public.store_wallet_refund_cart_item(uuid)') IS NULL OR
     to_regprocedure('public.store_claim_cart_payment(uuid,text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'SYNTHESIS_CART_FUNCTIONS_INCOMPLETE: recheck migration 027';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.store_cart_schema_status WHERE id='cart-v1' AND schema_version=1) THEN
    RAISE EXCEPTION 'SYNTHESIS_CART_MARKER_MISSING: migration 027 did not finish';
  END IF;

  -- Backfill purchase history before making welcome/referral rewards available. This
  -- prevents existing customers from being treated as new after rollout/reinstall.
  WITH paid_orders AS (
    SELECT client_id, paid_at, upper(COALESCE(price_basis,'CUP')) AS currency
    FROM public.game_recharge_orders
    WHERE paid_at IS NOT NULL AND status <> 'REFUNDED'
    UNION ALL
    SELECT client_id, paid_at, 'CUP' AS currency
    FROM public.etecsa_orders
    WHERE paid_at IS NOT NULL AND status <> 'REFUNDED'
    UNION ALL
    SELECT client_id, paid_at, upper(COALESCE(price_basis,'CUP')) AS currency
    FROM public.store_cart_orders
    WHERE paid_at IS NOT NULL AND status <> 'REFUNDED'
  ), earliest AS (
    SELECT client_id, MIN(paid_at) AS first_paid_at,
      MIN(paid_at) FILTER (WHERE currency='CUP') AS first_cup_at
    FROM paid_orders GROUP BY client_id
  )
  UPDATE public.reward_profiles rp
  SET first_paid_purchase_at=COALESCE(rp.first_paid_purchase_at,e.first_paid_at),
      first_cup_purchase_at=COALESCE(rp.first_cup_purchase_at,e.first_cup_at),
      purchase_history_checked_at=now(), updated_at=now()
  FROM earliest e
  WHERE e.client_id=rp.client_id AND rp.purchase_history_checked_at IS NULL;

  UPDATE public.reward_profiles SET purchase_history_checked_at=now()
  WHERE purchase_history_checked_at IS NULL;

  INSERT INTO public.reward_schema_status (id, schema_version, applied_at)
  VALUES ('rewards-v1', 1, now())
  ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version, applied_at=EXCLUDED.applied_at;
END $$;

COMMENT ON TABLE public.reward_schema_status IS 'Readiness sentinel written only after all SynthesisOne reward and cart migrations are verified.';
