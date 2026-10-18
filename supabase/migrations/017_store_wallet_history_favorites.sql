-- SynthesisOne SO — customer purchase history, persistent internal Wallet and wallet-funded Game Market orders.
-- Apply this migration in the SAME Supabase project used by the Render backend before deployment.

CREATE TABLE IF NOT EXISTS public.store_wallets (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  balance_cup numeric(18,2) NOT NULL DEFAULT 0 CHECK (balance_cup >= 0),
  total_credited_cup numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_credited_cup >= 0),
  total_spent_cup numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_spent_cup >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('CREDIT','SPEND','REFUND')),
  amount_cup numeric(18,2) NOT NULL CHECK (amount_cup > 0),
  balance_after_cup numeric(18,2) NOT NULL CHECK (balance_after_cup >= 0),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  idempotency_key text,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_wallet_transactions_reference_unique UNIQUE (client_id, reference_type, reference_id),
  CONSTRAINT store_wallet_transactions_idempotency_unique UNIQUE (client_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS store_wallet_transactions_client_created_idx
  ON public.store_wallet_transactions (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  amount_cup numeric(18,2) NOT NULL CHECK (amount_cup > 0),
  payer_phone text NOT NULL,
  destination_card text NOT NULL,
  confirmation_phone text NOT NULL,
  status text NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK (status IN ('WAITING_PAYMENT','COMPLETED','CANCELED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payment_deadline_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_transaction_at timestamptz,
  payment_transaction_id text,
  payment_sms_log_id text
);
CREATE INDEX IF NOT EXISTS store_wallet_topups_client_created_idx
  ON public.store_wallet_topups (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS store_wallet_topups_one_waiting_per_client_idx
  ON public.store_wallet_topups (client_id) WHERE status = 'WAITING_PAYMENT';
CREATE UNIQUE INDEX IF NOT EXISTS store_wallet_topups_payment_transaction_unique_idx
  ON public.store_wallet_topups (payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL AND payment_transaction_id <> '';

-- Wallet-funded Game Market orders do not need a Transfermóvil destination.
ALTER TABLE public.game_recharge_orders
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'TRANSFERMOVIL';
ALTER TABLE public.game_recharge_orders DROP CONSTRAINT IF EXISTS game_recharge_orders_payment_source_check;
ALTER TABLE public.game_recharge_orders ADD CONSTRAINT game_recharge_orders_payment_source_check
  CHECK (payment_source IN ('TRANSFERMOVIL','WALLET'));
ALTER TABLE public.game_recharge_orders ALTER COLUMN payer_phone DROP NOT NULL;
ALTER TABLE public.game_recharge_orders ALTER COLUMN destination_card DROP NOT NULL;
ALTER TABLE public.game_recharge_orders ALTER COLUMN confirmation_phone DROP NOT NULL;

ALTER TABLE public.store_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_wallet_topups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_wallets FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.store_wallet_transactions FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.store_wallet_topups FROM public, anon, authenticated;
GRANT ALL ON TABLE public.store_wallets TO service_role;
GRANT ALL ON TABLE public.store_wallet_transactions TO service_role;
GRANT ALL ON TABLE public.store_wallet_topups TO service_role;

-- One Transfermóvil transaction can pay only one official store ticket across ETECSA, Game Market and Wallet.
CREATE TABLE IF NOT EXISTS public.store_payment_transaction_claims (
  transaction_id text PRIMARY KEY CHECK (length(transaction_id) BETWEEN 1 AND 120),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('ETECSA','GAMEMARKET','WALLET_TOPUP')),
  order_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_payment_transaction_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_payment_transaction_claims FROM public, anon, authenticated;
GRANT ALL ON TABLE public.store_payment_transaction_claims TO service_role;

CREATE OR REPLACE FUNCTION public.store_claim_payment_transaction(
  p_transaction_id text, p_client_id uuid, p_source text, p_order_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_claim public.store_payment_transaction_claims%ROWTYPE;
BEGIN
  IF p_transaction_id IS NULL OR length(trim(p_transaction_id)) = 0 THEN RETURN true; END IF;
  IF length(p_transaction_id) > 120 OR p_source NOT IN ('ETECSA','GAMEMARKET','WALLET_TOPUP') OR p_client_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_CLAIM' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.store_payment_transaction_claims (transaction_id, client_id, source, order_id)
  VALUES (trim(p_transaction_id), p_client_id, p_source, p_order_id)
  ON CONFLICT (transaction_id) DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  SELECT * INTO v_claim FROM public.store_payment_transaction_claims WHERE transaction_id = trim(p_transaction_id);
  RETURN FOUND AND v_claim.client_id = p_client_id AND v_claim.source = p_source AND v_claim.order_id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.store_claim_payment_transaction(text,uuid,text,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_claim_payment_transaction(text,uuid,text,uuid) TO service_role;

-- Credit a wallet top-up exactly once, only after server-side SMS matching has selected it.
CREATE OR REPLACE FUNCTION public.store_wallet_credit_topup(
  p_topup_id uuid,
  p_payment_transaction_id text DEFAULT NULL,
  p_payment_sms_log_id text DEFAULT NULL,
  p_payment_transaction_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.store_wallet_topups%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_balance numeric(18,2);
BEGIN
  SELECT * INTO v_topup FROM public.store_wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOPUP_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_topup.status = 'COMPLETED' THEN
    SELECT balance_cup INTO v_balance FROM public.store_wallets WHERE client_id = v_topup.client_id;
    RETURN jsonb_build_object('already_processed', true, 'topup_id', v_topup.id, 'balance_cup', COALESCE(v_balance,0));
  END IF;
  IF v_topup.status NOT IN ('WAITING_PAYMENT','EXPIRED') THEN
    RAISE EXCEPTION 'TOPUP_NOT_PAYABLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_payment_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_wallet_topups WHERE payment_transaction_id = p_payment_transaction_id AND id <> p_topup_id
  ) THEN RAISE EXCEPTION 'DUPLICATE_PAYMENT_TRANSACTION' USING ERRCODE = '23505'; END IF;

  INSERT INTO public.store_wallets (client_id) VALUES (v_topup.client_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = v_topup.client_id FOR UPDATE;
  v_balance := v_wallet.balance_cup + v_topup.amount_cup;
  UPDATE public.store_wallets SET balance_cup = v_balance,
    total_credited_cup = total_credited_cup + v_topup.amount_cup, updated_at = now()
    WHERE client_id = v_topup.client_id;
  INSERT INTO public.store_wallet_transactions (
    client_id, kind, amount_cup, balance_after_cup, reference_type, reference_id, description
  ) VALUES (
    v_topup.client_id, 'CREDIT', v_topup.amount_cup, v_balance, 'WALLET_TOPUP', v_topup.id::text,
    'Fondos añadidos a Wallet'
  );
  UPDATE public.store_wallet_topups SET status = 'COMPLETED', paid_at = now(),
    payment_transaction_id = NULLIF(p_payment_transaction_id,''),
    payment_sms_log_id = NULLIF(p_payment_sms_log_id,''),
    payment_transaction_at = p_payment_transaction_at, updated_at = now()
    WHERE id = p_topup_id;
  RETURN jsonb_build_object('already_processed', false, 'topup_id', v_topup.id, 'balance_cup', v_balance);
END;
$$;

-- Atomically debit the internal balance and create the immutable, wallet-paid game order.
CREATE OR REPLACE FUNCTION public.store_wallet_create_game_order(
  p_client_id uuid,
  p_amount numeric,
  p_order jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.store_wallets%ROWTYPE;
  v_balance numeric(18,2);
  v_order_id uuid;
  v_existing public.store_wallet_transactions%ROWTYPE;
  v_order public.game_recharge_orders%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(length(trim(p_idempotency_key)),0) < 8 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM public.store_wallet_transactions
    WHERE client_id = p_client_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reference_type <> 'GAME_RECHARGE' THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO v_order FROM public.game_recharge_orders WHERE id = v_existing.reference_id::uuid;
    RETURN jsonb_build_object('already_processed', true, 'order', to_jsonb(v_order), 'balance_cup', v_existing.balance_after_cup);
  END IF;

  INSERT INTO public.store_wallets (client_id) VALUES (p_client_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = p_client_id FOR UPDATE;
  IF v_wallet.balance_cup < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE = 'P0001'; END IF;
  v_order_id := (p_order->>'id')::uuid;
  IF EXISTS (SELECT 1 FROM public.game_recharge_orders WHERE id = v_order_id) THEN
    RAISE EXCEPTION 'ORDER_ALREADY_EXISTS' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.game_recharge_orders (
    id, client_id, offer_id, game_name, offer_title, provider_product_key, provider_product_name,
    provider_game_slug, provider_region_slug, provider_region_name, provider_delivery, provider_kind,
    provider_cost_usdt, price_basis, payment_amount, payer_phone, destination_card, confirmation_phone,
    status, buyer_ref, player_id, server_id, created_at, updated_at, payment_deadline_at, paid_at, payment_source
  ) VALUES (
    v_order_id, p_client_id, (p_order->>'offer_id')::uuid, p_order->>'game_name', p_order->>'offer_title',
    p_order->>'provider_product_key', p_order->>'provider_product_name', p_order->>'provider_game_slug',
    NULLIF(p_order->>'provider_region_slug','') , NULLIF(p_order->>'provider_region_name',''),
    p_order->>'provider_delivery', COALESCE(NULLIF(p_order->>'provider_kind',''),'topup'),
    (p_order->>'provider_cost_usdt')::numeric, p_order->>'price_basis', p_amount,
    NULLIF(p_order->>'payer_phone',''), NULL, NULL, 'SUBMITTING_TO_PROVIDER', p_order->>'buyer_ref',
    NULLIF(p_order->>'player_id',''), NULLIF(p_order->>'server_id',''), v_now, v_now, v_now + interval '30 minutes', v_now, 'WALLET'
  ) RETURNING * INTO v_order;

  v_balance := v_wallet.balance_cup - p_amount;
  UPDATE public.store_wallets SET balance_cup = v_balance,
    total_spent_cup = total_spent_cup + p_amount, updated_at = now()
    WHERE client_id = p_client_id;
  INSERT INTO public.store_wallet_transactions (
    client_id, kind, amount_cup, balance_after_cup, reference_type, reference_id, idempotency_key, description
  ) VALUES (
    p_client_id, 'SPEND', p_amount, v_balance, 'GAME_RECHARGE', v_order_id::text, p_idempotency_key,
    'Compra en Game Market'
  );
  RETURN jsonb_build_object('already_processed', false, 'order', to_jsonb(v_order), 'balance_cup', v_balance);
END;
$$;

-- Refund a failed wallet-funded delivery once. Review/unknown provider outcomes are NOT auto-refunded.
CREATE OR REPLACE FUNCTION public.store_wallet_refund_game_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.game_recharge_orders%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_balance numeric(18,2);
BEGIN
  SELECT * INTO v_order FROM public.game_recharge_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_order.payment_source <> 'WALLET' OR v_order.status <> 'REFUND_REQUIRED' THEN
    RAISE EXCEPTION 'ORDER_NOT_REFUNDABLE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = v_order.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.store_wallet_transactions WHERE client_id = v_order.client_id AND reference_type = 'GAME_RECHARGE_REFUND' AND reference_id = v_order.id::text) THEN
    RETURN jsonb_build_object('already_refunded', true, 'balance_cup', v_wallet.balance_cup);
  END IF;
  v_balance := v_wallet.balance_cup + v_order.payment_amount;
  UPDATE public.store_wallets SET balance_cup = v_balance, total_credited_cup = total_credited_cup + v_order.payment_amount, updated_at = now()
    WHERE client_id = v_order.client_id;
  INSERT INTO public.store_wallet_transactions (client_id,kind,amount_cup,balance_after_cup,reference_type,reference_id,description)
    VALUES (v_order.client_id,'REFUND',v_order.payment_amount,v_balance,'GAME_RECHARGE_REFUND',v_order.id::text,'Devolución por fallo de entrega');
  RETURN jsonb_build_object('already_refunded', false, 'balance_cup', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.store_wallet_credit_topup(uuid,text,text,timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_wallet_refund_game_order(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_credit_topup(uuid,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_refund_game_order(uuid) TO service_role;

COMMENT ON TABLE public.store_wallets IS 'Internal balance held in CUP for SynthesisOne official-store customers.';
COMMENT ON TABLE public.store_wallet_transactions IS 'Append-only ledger for wallet topups, purchases, and refunds.';
COMMENT ON TABLE public.store_wallet_topups IS 'Transfermóvil top-up tickets credited only after a matched incoming payment SMS.';
