-- SynthesisOne SO — persistent, idempotent Wallet refund recovery for failed Game Market orders.
-- Apply after migrations 017, 018 and 019 in the same Supabase project as the Render backend.
BEGIN;

-- Defensive bootstrap for deployments that accidentally ran this repair before 019.
-- Migration 019 remains required for the incident RPCs/announcement routes, but this
-- table definition prevents the historic "service_incidents does not exist" failure.
CREATE TABLE IF NOT EXISTS public.service_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  component text NOT NULL,
  severity text NOT NULL DEFAULT 'WARN' CHECK (severity IN ('INFO','WARN','ERROR','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_incidents_status_last_seen_idx ON public.service_incidents (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS service_incidents_component_status_idx ON public.service_incidents (component, status, last_seen_at DESC);
ALTER TABLE public.service_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_incidents FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.service_incidents FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.service_incidents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_incidents TO service_role;

ALTER TABLE public.game_recharge_orders
  ADD COLUMN IF NOT EXISTS wallet_refunded_at timestamptz;

ALTER TABLE public.game_recharge_orders
  DROP CONSTRAINT IF EXISTS game_recharge_orders_status_check;
ALTER TABLE public.game_recharge_orders
  ADD CONSTRAINT game_recharge_orders_status_check CHECK (status IN (
    'WAITING_PAYMENT','PAYMENT_RECEIVED_WAITING_DETAILS','SUBMITTING_TO_PROVIDER',
    'PROCESSING','COMPLETED','CANCELED','EXPIRED','FULFILLMENT_REVIEW',
    'REFUND_REQUIRED','REFUNDED'
  ));

-- Record a critical incident before normalizing a contradictory state: a delivery may
-- have been marked completed while a refund ledger entry also exists. Preserve that trail.
INSERT INTO public.service_incidents (
  fingerprint, component, severity, status, title, message, metadata,
  occurrence_count, first_seen_at, last_seen_at, updated_at
)
SELECT
  'wallet-refund-delivery-conflict:' || o.id::text,
  'wallet', 'CRITICAL', 'OPEN',
  'Un pedido de juego figura entregado y reembolsado',
  'Existe un movimiento de devolución de Wallet para un pedido cuyo estado anterior era COMPLETED. Verifica la entrega con RechargeGames y el balance antes de cerrar la incidencia.',
  jsonb_build_object('order_id', o.id, 'client_id', o.client_id, 'payment_amount', o.payment_amount,
    'provider_order_id', o.provider_order_id, 'provider_status', o.provider_status),
  1, now(), now(), now()
FROM public.game_recharge_orders o
JOIN public.store_wallet_transactions tx
  ON tx.client_id = o.client_id
 AND tx.reference_type = 'GAME_RECHARGE_REFUND'
 AND tx.reference_id = o.id::text
 AND tx.kind = 'REFUND'
WHERE o.payment_source = 'WALLET' AND o.status = 'COMPLETED'
ON CONFLICT (fingerprint) DO UPDATE SET
  status = 'OPEN', severity = 'CRITICAL', last_seen_at = now(), updated_at = now(),
  occurrence_count = public.service_incidents.occurrence_count + 1,
  metadata = EXCLUDED.metadata;

-- Historical refunds made by migration 018 were credited, but that version never marked
-- the order REFUNDED. Recover its state from the authoritative unique refund ledger entry.
UPDATE public.game_recharge_orders o
SET wallet_refunded_at = COALESCE(o.wallet_refunded_at, tx.created_at),
    status = 'REFUNDED',
    updated_at = now()
FROM public.store_wallet_transactions tx
WHERE tx.client_id = o.client_id
  AND tx.reference_type = 'GAME_RECHARGE_REFUND'
  AND tx.reference_id = o.id::text
  AND tx.kind = 'REFUND'
  AND o.payment_source = 'WALLET'
  AND (o.wallet_refunded_at IS NULL OR o.status <> 'REFUNDED');

CREATE INDEX IF NOT EXISTS game_recharge_orders_wallet_refund_pending_idx
  ON public.game_recharge_orders (updated_at)
  WHERE payment_source = 'WALLET' AND status = 'REFUND_REQUIRED' AND wallet_refunded_at IS NULL;

CREATE OR REPLACE FUNCTION public.store_wallet_refund_game_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.game_recharge_orders%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_balance numeric(18,2);
  v_ledger_net numeric(18,2);
  v_refund_tx public.store_wallet_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.game_recharge_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_order.payment_source <> 'WALLET' THEN
    RAISE EXCEPTION 'ORDER_NOT_WALLET_FUNDED' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = v_order.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup
                           WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END),0)
    INTO v_ledger_net
    FROM public.store_wallet_transactions WHERE client_id = v_order.client_id;
  IF abs(v_wallet.balance_cup - v_ledger_net) > 0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_topups t
    LEFT JOIN public.store_wallet_transactions tx
      ON tx.client_id = t.client_id AND tx.kind = 'CREDIT'
     AND tx.reference_type = 'WALLET_TOPUP' AND tx.reference_id = t.id::text
    WHERE t.client_id = v_order.client_id AND t.status = 'COMPLETED'
      AND (tx.id IS NULL OR abs(tx.amount_cup - t.amount_cup) > 0.01)
  ) THEN
    RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_MISSING' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_refund_tx FROM public.store_wallet_transactions
  WHERE client_id = v_order.client_id AND reference_type = 'GAME_RECHARGE_REFUND'
    AND reference_id = v_order.id::text AND kind = 'REFUND'
  FOR UPDATE;

  IF v_order.status = 'REFUNDED' THEN
    IF NOT FOUND OR v_order.wallet_refunded_at IS NULL THEN
      RAISE EXCEPTION 'WALLET_REFUND_LEDGER_MISSING' USING ERRCODE = 'P0001';
    END IF;
    IF abs(v_refund_tx.amount_cup - v_order.payment_amount) > 0.01 THEN
      RAISE EXCEPTION 'WALLET_REFUND_AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('already_refunded', true, 'status', 'REFUNDED', 'balance_cup', v_wallet.balance_cup);
  END IF;

  IF v_order.status <> 'REFUND_REQUIRED' THEN
    RAISE EXCEPTION 'ORDER_NOT_REFUNDABLE' USING ERRCODE = 'P0001';
  END IF;

  -- If a prior execution committed the ledger but not the status (e.g. legacy behavior),
  -- normalize the status without adding another credit.
  IF FOUND THEN
    IF abs(v_refund_tx.amount_cup - v_order.payment_amount) > 0.01 THEN
      RAISE EXCEPTION 'WALLET_REFUND_AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.game_recharge_orders SET status = 'REFUNDED',
      wallet_refunded_at = COALESCE(wallet_refunded_at, v_refund_tx.created_at), updated_at = now()
      WHERE id = v_order.id;
    RETURN jsonb_build_object('already_refunded', true, 'status', 'REFUNDED', 'balance_cup', v_wallet.balance_cup);
  END IF;

  v_balance := v_wallet.balance_cup + v_order.payment_amount;
  UPDATE public.store_wallets SET balance_cup = v_balance,
    total_credited_cup = total_credited_cup + v_order.payment_amount, updated_at = now()
    WHERE client_id = v_order.client_id;
  INSERT INTO public.store_wallet_transactions (
    client_id, kind, amount_cup, balance_after_cup, reference_type, reference_id, description
  ) VALUES (
    v_order.client_id, 'REFUND', v_order.payment_amount, v_balance,
    'GAME_RECHARGE_REFUND', v_order.id::text, 'Devolución por fallo de entrega'
  );
  UPDATE public.game_recharge_orders SET status = 'REFUNDED', wallet_refunded_at = now(), updated_at = now()
    WHERE id = v_order.id;
  RETURN jsonb_build_object('already_refunded', false, 'status', 'REFUNDED', 'balance_cup', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.store_wallet_refund_game_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_refund_game_order(uuid) TO service_role;

COMMENT ON COLUMN public.game_recharge_orders.wallet_refunded_at IS
  'Timestamp of a committed Wallet refund; only set by the idempotent refund RPC or recovery migration.';

COMMIT;

-- Post-migration review: any incident returned here needs manual provider-vs-ledger resolution.
SELECT id, fingerprint, component, severity, status, title, metadata, last_seen_at
FROM public.service_incidents
WHERE fingerprint LIKE 'wallet-refund-delivery-conflict:%' AND status <> 'RESOLVED'
ORDER BY last_seen_at DESC;
