-- SynthesisOne: server-authoritative multi-item cart.
-- Apply after 026_referrals_rewards_coupons.sql. Cart APIs remain disabled unless
-- SYNTHESIS_CART_ENABLED=true is set after the migration has been validated.

CREATE TABLE IF NOT EXISTS public.store_cart_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'BUILDING_CART' CHECK (status IN (
    'BUILDING_CART','WAITING_PAYMENT','PROCESSING','COMPLETED','CANCELED','EXPIRED','FULFILLMENT_REVIEW','REFUNDED'
  )),
  payment_source text NOT NULL CHECK (payment_source IN ('TRANSFERMOVIL','WALLET')),
  price_basis text NOT NULL CHECK (price_basis IN ('CUP','SALDO')),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 25),
  base_subtotal numeric(14,2) NOT NULL CHECK (base_subtotal > 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  payment_amount numeric(14,2) NOT NULL CHECK (payment_amount > 0),
  reward_coupon_id uuid REFERENCES public.reward_coupons(id) ON DELETE SET NULL,
  welcome_discount boolean NOT NULL DEFAULT false,
  payer_phone text,
  destination_card text,
  confirmation_phone text,
  payment_deadline_at timestamptz,
  paid_at timestamptz,
  payment_transaction_at timestamptz,
  payment_transaction_id text,
  payment_sms_log_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key),
  CHECK (discount_amount <= base_subtotal),
  CHECK (abs((base_subtotal - discount_amount) - payment_amount) <= 0.01),
  CHECK ((payment_source = 'TRANSFERMOVIL' AND price_basis = 'CUP' AND payer_phone IS NOT NULL AND destination_card IS NOT NULL AND confirmation_phone IS NOT NULL AND payment_deadline_at IS NOT NULL)
      OR (payment_source = 'WALLET' AND payer_phone IS NULL AND destination_card IS NULL AND confirmation_phone IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS store_cart_orders_one_waiting_per_client_idx
  ON public.store_cart_orders (client_id) WHERE status IN ('BUILDING_CART','WAITING_PAYMENT');
CREATE UNIQUE INDEX IF NOT EXISTS store_cart_orders_payment_transaction_unique_idx
  ON public.store_cart_orders (payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL AND payment_transaction_id <> '';
CREATE INDEX IF NOT EXISTS store_cart_orders_client_created_idx
  ON public.store_cart_orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_cart_orders_reconcile_idx
  ON public.store_cart_orders (status, created_at)
  WHERE status IN ('WAITING_PAYMENT','EXPIRED','PROCESSING','FULFILLMENT_REVIEW');

CREATE TABLE IF NOT EXISTS public.store_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.store_cart_orders(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 25),
  source text NOT NULL CHECK (source IN ('GAME_MARKET','ETECSA')),
  offer_id text NOT NULL,
  price_id text,
  product_title text NOT NULL,
  price_basis text NOT NULL CHECK (price_basis IN ('CUP','SALDO')),
  base_amount numeric(14,2) NOT NULL CHECK (base_amount > 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  payment_amount numeric(14,2) NOT NULL CHECK (payment_amount > 0),
  product_snapshot jsonb NOT NULL,
  player_id text,
  server_id text,
  recipient text,
  recipient_name text,
  email text,
  child_order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_FULFILLMENT' CHECK (status IN (
    'PENDING_FULFILLMENT','PROCESSING','COMPLETED','FULFILLMENT_REVIEW','REFUND_REQUIRED','REFUNDED'
  )),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, line_no),
  UNIQUE (child_order_id)
);
CREATE INDEX IF NOT EXISTS store_cart_items_cart_line_idx ON public.store_cart_items (cart_id, line_no);
CREATE INDEX IF NOT EXISTS store_cart_items_processing_idx ON public.store_cart_items (status, updated_at)
  WHERE status IN ('PENDING_FULFILLMENT','PROCESSING','FULFILLMENT_REVIEW','REFUND_REQUIRED');

ALTER TABLE public.game_recharge_orders
  ADD COLUMN IF NOT EXISTS store_cart_id uuid REFERENCES public.store_cart_orders(id) ON DELETE SET NULL;
ALTER TABLE public.etecsa_orders
  ADD COLUMN IF NOT EXISTS store_cart_id uuid REFERENCES public.store_cart_orders(id) ON DELETE SET NULL;

-- One cart purchase is one mission event, with flags to preserve multi-catalog mission logic.
ALTER TABLE public.reward_purchase_events
  DROP CONSTRAINT IF EXISTS reward_purchase_events_source_check;
ALTER TABLE public.reward_purchase_events
  ADD CONSTRAINT reward_purchase_events_source_check CHECK (source IN ('GAME_MARKET','ETECSA','CART'));
ALTER TABLE public.reward_purchase_events
  ADD COLUMN IF NOT EXISTS has_game_market boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_etecsa boolean NOT NULL DEFAULT false;
UPDATE public.reward_purchase_events SET
  has_game_market = (source = 'GAME_MARKET'),
  has_etecsa = (source = 'ETECSA')
WHERE NOT has_game_market AND NOT has_etecsa;

-- A cart transfer must use the same global one-transaction/one-ticket claim ledger.
ALTER TABLE public.store_payment_transaction_claims
  DROP CONSTRAINT IF EXISTS store_payment_transaction_claims_source_check;
ALTER TABLE public.store_payment_transaction_claims
  ADD CONSTRAINT store_payment_transaction_claims_source_check CHECK (source IN ('ETECSA','GAMEMARKET','WALLET_TOPUP','CART'));
CREATE OR REPLACE FUNCTION public.store_claim_payment_transaction(
  p_transaction_id text, p_client_id uuid, p_source text, p_order_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.store_payment_transaction_claims%ROWTYPE;
BEGIN
  IF p_transaction_id IS NULL OR length(trim(p_transaction_id)) = 0 THEN RETURN true; END IF;
  IF length(p_transaction_id) > 120 OR p_source NOT IN ('ETECSA','GAMEMARKET','WALLET_TOPUP','CART') OR p_client_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_CLAIM' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.store_payment_transaction_claims (transaction_id, client_id, source, order_id)
  VALUES (trim(p_transaction_id), p_client_id, p_source, p_order_id) ON CONFLICT (transaction_id) DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  SELECT * INTO v_claim FROM public.store_payment_transaction_claims WHERE transaction_id = trim(p_transaction_id);
  RETURN FOUND AND v_claim.client_id = p_client_id AND v_claim.source = p_source AND v_claim.order_id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.store_claim_payment_transaction(text,uuid,text,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_claim_payment_transaction(text,uuid,text,uuid) TO service_role;

-- One atomic debit creates the cart parent and every line item. It deliberately only
-- serves GAME_MARKET Wallet carts; ETECSA Wallet is not a supported legacy payment path.
CREATE OR REPLACE FUNCTION public.store_wallet_create_cart_order(
  p_client_id uuid,
  p_amount numeric,
  p_currency text,
  p_cart jsonb,
  p_items jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.store_wallets%ROWTYPE;
  v_cart public.store_cart_orders%ROWTYPE;
  v_existing public.store_wallet_transactions%ROWTYPE;
  v_balance numeric(18,2);
  v_ledger_cup numeric(18,2);
  v_ledger_saldo numeric(18,2);
  v_currency text := upper(trim(COALESCE(p_currency,'CUP')));
  v_cart_id uuid;
  v_fingerprint text;
  v_now timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF v_currency NOT IN ('CUP','SALDO') THEN RAISE EXCEPTION 'INVALID_WALLET_CURRENCY' USING ERRCODE='P0001'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR abs((p_cart->>'payment_amount')::numeric-p_amount)>0.01 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001'; END IF;
  IF COALESCE(length(trim(p_idempotency_key)),0)<8 OR length(p_idempotency_key)>128 THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='P0001'; END IF;
  IF upper(COALESCE(p_cart->>'price_basis','')) <> v_currency OR upper(COALESCE(p_cart->>'payment_source','')) <> 'WALLET' THEN RAISE EXCEPTION 'CART_CURRENCY_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 25 THEN RAISE EXCEPTION 'CART_ITEM_COUNT_INVALID' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS i(source text, price_basis text, base_amount numeric, discount_amount numeric, payment_amount numeric) WHERE COALESCE(i.source,'') <> 'GAME_MARKET' OR upper(COALESCE(i.price_basis,'')) <> v_currency OR COALESCE(i.base_amount,0) <= 0 OR COALESCE(i.discount_amount,0) < 0 OR COALESCE(i.discount_amount,0) >= COALESCE(i.base_amount,0) OR COALESCE(i.payment_amount,0) <= 0 OR abs((i.base_amount-i.discount_amount)-i.payment_amount)>0.01) THEN
    RAISE EXCEPTION 'WALLET_CART_UNSUPPORTED_ITEMS' USING ERRCODE='P0001';
  END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(p_items) AS i(source text)) <> (p_cart->>'item_count')::integer THEN RAISE EXCEPTION 'CART_ITEM_COUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF abs((SELECT COALESCE(sum(i.base_amount),0) FROM jsonb_to_recordset(p_items) AS i(base_amount numeric)) - (p_cart->>'base_subtotal')::numeric)>0.01 THEN RAISE EXCEPTION 'CART_SUBTOTAL_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF abs((SELECT COALESCE(sum(i.payment_amount),0) FROM jsonb_to_recordset(p_items) AS i(payment_amount numeric)) - p_amount)>0.01 THEN RAISE EXCEPTION 'CART_TOTAL_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF abs((SELECT COALESCE(sum(i.discount_amount),0) FROM jsonb_to_recordset(p_items) AS i(discount_amount numeric)) - COALESCE((p_cart->>'discount_amount')::numeric,0))>0.01 OR abs((p_cart->>'base_subtotal')::numeric - COALESCE((p_cart->>'discount_amount')::numeric,0) - p_amount)>0.01 THEN RAISE EXCEPTION 'CART_DISCOUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
  v_fingerprint := trim(COALESCE(p_cart->>'request_fingerprint',''));
  IF length(v_fingerprint) <> 64 THEN RAISE EXCEPTION 'CART_FINGERPRINT_INVALID' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.store_wallets(client_id) VALUES (p_client_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id=p_client_id FOR UPDATE;
  SELECT
    COALESCE(SUM(CASE WHEN currency='CUP' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind='SPEND' THEN -amount_cup ELSE 0 END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN currency='SALDO' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_saldo WHEN kind='SPEND' THEN -amount_saldo ELSE 0 END ELSE 0 END),0)
  INTO v_ledger_cup,v_ledger_saldo FROM public.store_wallet_transactions WHERE client_id=p_client_id;
  IF abs(v_wallet.balance_cup-v_ledger_cup)>0.01 OR abs(v_wallet.balance_saldo-v_ledger_saldo)>0.01 THEN RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE='P0001'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_topups t LEFT JOIN public.store_wallet_transactions tx
      ON tx.client_id=t.client_id AND tx.reference_type='WALLET_TOPUP' AND tx.reference_id=t.id::text AND tx.kind='CREDIT'
    WHERE t.client_id=p_client_id AND t.status='COMPLETED' AND
      (tx.id IS NULL OR tx.currency IS DISTINCT FROM t.currency OR
       (t.currency='CUP' AND abs(COALESCE(tx.amount_cup,0)-COALESCE(t.amount_cup,0))>0.01) OR
       (t.currency='SALDO' AND abs(COALESCE(tx.amount_saldo,0)-COALESCE(t.amount_saldo,0))>0.01))
  ) THEN RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_MISSING' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_existing FROM public.store_wallet_transactions WHERE client_id=p_client_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reference_type <> 'STORE_CART' OR v_existing.currency IS DISTINCT FROM v_currency THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='P0001'; END IF;
    SELECT * INTO v_cart FROM public.store_cart_orders WHERE id=v_existing.reference_id::uuid;
    IF NOT FOUND OR v_cart.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='P0001'; END IF;
    RETURN jsonb_build_object('already_processed',true,'cart',to_jsonb(v_cart),'currency',v_currency,
      'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo,
      'balance',CASE WHEN v_currency='CUP' THEN v_wallet.balance_cup ELSE v_wallet.balance_saldo END);
  END IF;
  IF v_currency='CUP' AND v_wallet.balance_cup<p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE='P0001'; END IF;
  IF v_currency='SALDO' AND v_wallet.balance_saldo<p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE='P0001'; END IF;

  v_cart_id := (p_cart->>'id')::uuid;
  INSERT INTO public.store_cart_orders (
    id,client_id,idempotency_key,request_fingerprint,status,payment_source,price_basis,item_count,
    base_subtotal,discount_percent,discount_amount,payment_amount,reward_coupon_id,welcome_discount,
    paid_at,created_at,updated_at
  ) VALUES (
    v_cart_id,p_client_id,p_idempotency_key,v_fingerprint,'PROCESSING','WALLET',v_currency,
    (p_cart->>'item_count')::integer,(p_cart->>'base_subtotal')::numeric,
    COALESCE((p_cart->>'discount_percent')::numeric,0),COALESCE((p_cart->>'discount_amount')::numeric,0),p_amount,
    NULLIF(p_cart->>'reward_coupon_id','')::uuid,COALESCE((p_cart->>'welcome_discount')::boolean,false),v_now,v_now,v_now
  ) RETURNING * INTO v_cart;

  INSERT INTO public.store_cart_items (
    id,cart_id,client_id,line_no,source,offer_id,price_id,product_title,price_basis,base_amount,
    discount_amount,payment_amount,product_snapshot,player_id,server_id,recipient,recipient_name,email,child_order_id,status
  )
  SELECT i.id,v_cart_id,p_client_id,i.line_no,i.source,i.offer_id,i.price_id,i.product_title,i.price_basis,
    i.base_amount,i.discount_amount,i.payment_amount,i.product_snapshot,i.player_id,i.server_id,i.recipient,i.recipient_name,i.email,i.child_order_id,'PENDING_FULFILLMENT'
  FROM jsonb_to_recordset(p_items) AS i(
    id uuid,line_no integer,source text,offer_id text,price_id text,product_title text,price_basis text,
    base_amount numeric,discount_amount numeric,payment_amount numeric,product_snapshot jsonb,
    player_id text,server_id text,recipient text,recipient_name text,email text,child_order_id uuid
  );
  IF (SELECT count(*) FROM public.store_cart_items WHERE cart_id=v_cart_id) <> (p_cart->>'item_count')::integer THEN RAISE EXCEPTION 'CART_ITEMS_NOT_PERSISTED' USING ERRCODE='P0001'; END IF;

  IF v_currency='CUP' THEN
    v_balance:=v_wallet.balance_cup-p_amount;
    UPDATE public.store_wallets SET balance_cup=v_balance,total_spent_cup=total_spent_cup+p_amount,updated_at=v_now WHERE client_id=p_client_id;
    INSERT INTO public.store_wallet_transactions(client_id,kind,currency,amount_cup,amount_saldo,balance_after_cup,balance_after_saldo,reference_type,reference_id,idempotency_key,description)
    VALUES(p_client_id,'SPEND','CUP',p_amount,NULL,v_balance,NULL,'STORE_CART',v_cart_id::text,p_idempotency_key,'Compra de carrito con Wallet CUP');
    v_wallet.balance_cup:=v_balance;
  ELSE
    v_balance:=v_wallet.balance_saldo-p_amount;
    UPDATE public.store_wallets SET balance_saldo=v_balance,total_spent_saldo=total_spent_saldo+p_amount,updated_at=v_now WHERE client_id=p_client_id;
    INSERT INTO public.store_wallet_transactions(client_id,kind,currency,amount_cup,amount_saldo,balance_after_cup,balance_after_saldo,reference_type,reference_id,idempotency_key,description)
    VALUES(p_client_id,'SPEND','SALDO',NULL,p_amount,NULL,v_balance,'STORE_CART',v_cart_id::text,p_idempotency_key,'Compra de carrito con Wallet Saldo Móvil');
    v_wallet.balance_saldo:=v_balance;
  END IF;
  RETURN jsonb_build_object('already_processed',false,'cart',to_jsonb(v_cart),'currency',v_currency,
    'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo,'balance',v_balance);
END;
$$;

ALTER TABLE public.store_cart_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_cart_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_cart_orders FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.store_cart_items FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.store_cart_orders TO service_role;
GRANT ALL ON TABLE public.store_cart_items TO service_role;
REVOKE ALL ON FUNCTION public.store_wallet_create_cart_order(uuid,numeric,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_create_cart_order(uuid,numeric,text,jsonb,jsonb,text) TO service_role;

COMMENT ON TABLE public.store_cart_orders IS 'One authoritative order and payment for a multi-item SynthesisOne cart.';
COMMENT ON TABLE public.store_cart_items IS 'Validated, snapshotted cart lines and idempotent links to existing product fulfilment orders.';
COMMENT ON FUNCTION public.store_wallet_create_cart_order(uuid,numeric,text,jsonb,jsonb,text) IS 'Atomically validates Wallet ledger integrity, debits one currency and persists all Game Market cart lines.';

-- Atomically claim a transfer transaction and settle the cart parent. This prevents a
-- cancel/payment race from consuming a global transaction claim while leaving a paid
-- customer order canceled or waiting forever. Legacy checkout RPCs remain unchanged.
CREATE OR REPLACE FUNCTION public.store_claim_cart_payment(
  p_cart_id uuid,
  p_transaction_id text DEFAULT NULL,
  p_sms_log_id text DEFAULT NULL,
  p_transaction_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cart public.store_cart_orders%ROWTYPE;
  v_claim public.store_payment_transaction_claims%ROWTYPE;
  v_tx text := NULLIF(trim(COALESCE(p_transaction_id,'')), '');
  v_now timestamptz := now();
BEGIN
  IF p_cart_id IS NULL THEN RAISE EXCEPTION 'CART_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF v_tx IS NOT NULL AND length(v_tx) > 120 THEN RAISE EXCEPTION 'INVALID_PAYMENT_TRANSACTION' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_cart FROM public.store_cart_orders WHERE id=p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','CART_NOT_FOUND'); END IF;

  IF v_cart.status IN ('PROCESSING','COMPLETED','FULFILLMENT_REVIEW','REFUNDED') THEN
    IF v_tx IS NULL OR v_cart.payment_transaction_id IS NOT DISTINCT FROM v_tx THEN
      RETURN jsonb_build_object('claimed',true,'already_paid',true,'cart',to_jsonb(v_cart));
    END IF;
    RETURN jsonb_build_object('claimed',false,'reason','CART_ALREADY_PAID');
  END IF;
  IF v_cart.status NOT IN ('WAITING_PAYMENT','EXPIRED') THEN
    RETURN jsonb_build_object('claimed',false,'reason','CART_NOT_PAYABLE','status',v_cart.status);
  END IF;

  IF v_tx IS NOT NULL THEN
    INSERT INTO public.store_payment_transaction_claims (transaction_id,client_id,source,order_id)
    VALUES (v_tx,v_cart.client_id,'CART',v_cart.id)
    ON CONFLICT (transaction_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT * INTO v_claim FROM public.store_payment_transaction_claims WHERE transaction_id=v_tx;
      IF NOT FOUND OR v_claim.client_id IS DISTINCT FROM v_cart.client_id OR
         v_claim.source IS DISTINCT FROM 'CART' OR v_claim.order_id IS DISTINCT FROM v_cart.id THEN
        RETURN jsonb_build_object('claimed',false,'reason','TRANSACTION_ALREADY_CLAIMED');
      END IF;
    END IF;
  END IF;

  UPDATE public.store_cart_orders SET status='PROCESSING', paid_at=COALESCE(p_transaction_at,v_now),
    payment_transaction_id=v_tx, payment_sms_log_id=NULLIF(left(trim(COALESCE(p_sms_log_id,'')),120),''),
    payment_transaction_at=p_transaction_at, updated_at=v_now
  WHERE id=v_cart.id AND status IN ('WAITING_PAYMENT','EXPIRED')
  RETURNING * INTO v_cart;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','CART_STATE_CHANGED'); END IF;
  RETURN jsonb_build_object('claimed',true,'already_paid',false,'cart',to_jsonb(v_cart));
END;
$$;
REVOKE ALL ON FUNCTION public.store_claim_cart_payment(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_claim_cart_payment(uuid,text,text,timestamptz) TO service_role;
COMMENT ON FUNCTION public.store_claim_cart_payment(uuid,text,text,timestamptz) IS 'Atomically claims a Transfermóvil transaction and marks the matching cart paid, avoiding cancellation races.';

-- Cart Wallet refunds are per-line credits against the single original STORE_CART debit.
-- This is deliberately separate from store_wallet_refund_game_order, which only refunds
-- standalone GAME_RECHARGE movements and must not be used for a child of a cart.
CREATE OR REPLACE FUNCTION public.store_wallet_refund_cart_item(p_cart_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.store_cart_items%ROWTYPE;
  v_cart public.store_cart_orders%ROWTYPE;
  v_child public.game_recharge_orders%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_existing public.store_wallet_transactions%ROWTYPE;
  v_spend public.store_wallet_transactions%ROWTYPE;
  v_ledger_cup numeric(18,2);
  v_ledger_saldo numeric(18,2);
  v_refunded numeric(18,2);
  v_balance numeric(18,2);
  v_currency text;
  v_now timestamptz := now();
BEGIN
  IF p_cart_item_id IS NULL THEN RAISE EXCEPTION 'CART_ITEM_REQUIRED' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_item FROM public.store_cart_items WHERE id=p_cart_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CART_ITEM_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_cart FROM public.store_cart_orders WHERE id=v_item.cart_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CART_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_item FROM public.store_cart_items WHERE id=p_cart_item_id FOR UPDATE;
  IF v_cart.payment_source <> 'WALLET' OR v_item.source <> 'GAME_MARKET' THEN
    RAISE EXCEPTION 'CART_ITEM_NOT_WALLET_FUNDED' USING ERRCODE='P0001';
  END IF;
  v_currency := v_cart.price_basis;
  SELECT * INTO v_child FROM public.game_recharge_orders WHERE id=v_item.child_order_id FOR UPDATE;
  IF NOT FOUND OR v_child.client_id IS DISTINCT FROM v_cart.client_id OR v_child.store_cart_id IS DISTINCT FROM v_cart.id THEN
    RAISE EXCEPTION 'CART_CHILD_ORDER_MISMATCH' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_existing FROM public.store_wallet_transactions
  WHERE client_id=v_cart.client_id AND reference_type='STORE_CART_REFUND'
    AND reference_id=v_item.id::text AND kind='REFUND' FOR UPDATE;
  IF FOUND THEN
    IF v_existing.currency IS DISTINCT FROM v_currency OR
       (v_currency='CUP' AND abs(COALESCE(v_existing.amount_cup,0)-v_item.payment_amount)>0.01) OR
       (v_currency='SALDO' AND abs(COALESCE(v_existing.amount_saldo,0)-v_item.payment_amount)>0.01) THEN
      RAISE EXCEPTION 'CART_REFUND_AMOUNT_MISMATCH' USING ERRCODE='P0001';
    END IF;
    UPDATE public.store_cart_items SET status='REFUNDED', failure_reason=COALESCE(failure_reason,'DELIVERY_FAILED'), updated_at=v_now WHERE id=v_item.id;
    UPDATE public.game_recharge_orders SET status='REFUNDED', wallet_refunded_at=COALESCE(wallet_refunded_at,v_existing.created_at), updated_at=v_now WHERE id=v_child.id;
    RETURN jsonb_build_object('already_refunded',true,'status','REFUNDED','currency',v_currency,
      'balance_cup',(SELECT balance_cup FROM public.store_wallets WHERE client_id=v_cart.client_id),
      'balance_saldo',(SELECT balance_saldo FROM public.store_wallets WHERE client_id=v_cart.client_id));
  END IF;

  IF v_item.status <> 'REFUND_REQUIRED' OR v_child.payment_source <> 'WALLET' OR
     v_child.status NOT IN ('REFUND_REQUIRED','FAILED') THEN
    RAISE EXCEPTION 'CART_ITEM_NOT_REFUNDABLE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id=v_cart.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT
    COALESCE(SUM(CASE WHEN currency='CUP' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind='SPEND' THEN -amount_cup ELSE 0 END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN currency='SALDO' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_saldo WHEN kind='SPEND' THEN -amount_saldo ELSE 0 END ELSE 0 END),0)
  INTO v_ledger_cup,v_ledger_saldo FROM public.store_wallet_transactions WHERE client_id=v_cart.client_id;
  IF abs(v_wallet.balance_cup-v_ledger_cup)>0.01 OR abs(v_wallet.balance_saldo-v_ledger_saldo)>0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_topups t LEFT JOIN public.store_wallet_transactions tx
      ON tx.client_id=t.client_id AND tx.reference_type='WALLET_TOPUP' AND tx.reference_id=t.id::text AND tx.kind='CREDIT'
    WHERE t.client_id=v_cart.client_id AND t.status='COMPLETED' AND
      (tx.id IS NULL OR tx.currency IS DISTINCT FROM t.currency OR
       (t.currency='CUP' AND abs(COALESCE(tx.amount_cup,0)-COALESCE(t.amount_cup,0))>0.01) OR
       (t.currency='SALDO' AND abs(COALESCE(tx.amount_saldo,0)-COALESCE(t.amount_saldo,0))>0.01))
  ) THEN RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_MISSING' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_spend FROM public.store_wallet_transactions
    WHERE client_id=v_cart.client_id AND kind='SPEND' AND reference_type='STORE_CART' AND reference_id=v_cart.id::text FOR UPDATE;
  IF NOT FOUND OR v_spend.currency IS DISTINCT FROM v_currency OR
     (v_currency='CUP' AND abs(COALESCE(v_spend.amount_cup,0)-v_cart.payment_amount)>0.01) OR
     (v_currency='SALDO' AND abs(COALESCE(v_spend.amount_saldo,0)-v_cart.payment_amount)>0.01) THEN
    RAISE EXCEPTION 'CART_WALLET_DEBIT_LEDGER_MISSING' USING ERRCODE='P0001';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN v_currency='CUP' THEN amount_cup ELSE amount_saldo END),0)
    INTO v_refunded FROM public.store_cart_items i JOIN public.store_wallet_transactions tx
      ON tx.client_id=i.client_id AND tx.kind='REFUND' AND tx.reference_type='STORE_CART_REFUND' AND tx.reference_id=i.id::text
    WHERE i.cart_id=v_cart.id AND tx.currency=v_currency;
  IF v_refunded + v_item.payment_amount > v_cart.payment_amount + 0.01 THEN
    RAISE EXCEPTION 'CART_REFUND_EXCEEDS_PAID_TOTAL' USING ERRCODE='P0001';
  END IF;

  IF v_currency='CUP' THEN
    v_balance := v_wallet.balance_cup + v_item.payment_amount;
    UPDATE public.store_wallets SET balance_cup=v_balance,total_credited_cup=total_credited_cup+v_item.payment_amount,updated_at=v_now WHERE client_id=v_cart.client_id;
    INSERT INTO public.store_wallet_transactions(client_id,kind,currency,amount_cup,amount_saldo,balance_after_cup,balance_after_saldo,reference_type,reference_id,description)
    VALUES(v_cart.client_id,'REFUND','CUP',v_item.payment_amount,NULL,v_balance,NULL,'STORE_CART_REFUND',v_item.id::text,'Devolución por fallo de una oferta del carrito');
  ELSE
    v_balance := v_wallet.balance_saldo + v_item.payment_amount;
    UPDATE public.store_wallets SET balance_saldo=v_balance,total_credited_saldo=total_credited_saldo+v_item.payment_amount,updated_at=v_now WHERE client_id=v_cart.client_id;
    INSERT INTO public.store_wallet_transactions(client_id,kind,currency,amount_cup,amount_saldo,balance_after_cup,balance_after_saldo,reference_type,reference_id,description)
    VALUES(v_cart.client_id,'REFUND','SALDO',NULL,v_item.payment_amount,NULL,v_balance,'STORE_CART_REFUND',v_item.id::text,'Devolución por fallo de una oferta del carrito');
  END IF;
  UPDATE public.game_recharge_orders SET status='REFUNDED',wallet_refunded_at=v_now,updated_at=v_now WHERE id=v_child.id;
  UPDATE public.store_cart_items SET status='REFUNDED',failure_reason=COALESCE(failure_reason,'DELIVERY_FAILED'),updated_at=v_now WHERE id=v_item.id;
  RETURN jsonb_build_object('already_refunded',false,'status','REFUNDED','currency',v_currency,
    'balance_cup',CASE WHEN v_currency='CUP' THEN v_balance ELSE v_wallet.balance_cup END,
    'balance_saldo',CASE WHEN v_currency='SALDO' THEN v_balance ELSE v_wallet.balance_saldo END);
END;
$$;
REVOKE ALL ON FUNCTION public.store_wallet_refund_cart_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_refund_cart_item(uuid) TO service_role;
COMMENT ON FUNCTION public.store_wallet_refund_cart_item(uuid) IS 'Idempotently refunds a failed Wallet-funded Game Market cart line against its original aggregate cart debit.';

-- Prevent any legacy webhook/worker path from refunding a cart child as if it had a
-- standalone GAME_RECHARGE debit. Standalone orders keep the existing function semantics.
CREATE OR REPLACE FUNCTION public.store_wallet_refund_game_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.game_recharge_orders%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_refund_tx public.store_wallet_transactions%ROWTYPE;
  v_balance numeric(18,2);
  v_currency text;
  v_ledger_cup numeric(18,2);
  v_ledger_saldo numeric(18,2);
BEGIN
  SELECT * INTO v_order FROM public.game_recharge_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  -- Cart children were not debited independently; only the cart-item RPC may refund them.
  IF v_order.store_cart_id IS NOT NULL THEN RAISE EXCEPTION 'CART_ORDER_REQUIRES_CART_REFUND_RPC' USING ERRCODE='P0001'; END IF;
  IF v_order.payment_source <> 'WALLET' THEN RAISE EXCEPTION 'ORDER_NOT_WALLET_FUNDED' USING ERRCODE='P0001'; END IF;
  v_currency:=upper(COALESCE(v_order.price_basis,'CUP'));
  IF v_currency NOT IN ('CUP','SALDO') THEN RAISE EXCEPTION 'ORDER_CURRENCY_INVALID' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id=v_order.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN currency='CUP' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind='SPEND' THEN -amount_cup ELSE 0 END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN currency='SALDO' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_saldo WHEN kind='SPEND' THEN -amount_saldo ELSE 0 END ELSE 0 END),0)
  INTO v_ledger_cup,v_ledger_saldo
  FROM public.store_wallet_transactions WHERE client_id=v_order.client_id;
  IF abs(v_wallet.balance_cup-v_ledger_cup)>0.01 OR abs(v_wallet.balance_saldo-v_ledger_saldo)>0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_topups t LEFT JOIN public.store_wallet_transactions tx
      ON tx.client_id=t.client_id AND tx.reference_type='WALLET_TOPUP' AND tx.reference_id=t.id::text AND tx.kind='CREDIT'
    WHERE t.client_id=v_order.client_id AND t.status='COMPLETED' AND
      (tx.id IS NULL OR tx.currency IS DISTINCT FROM t.currency OR
       (t.currency='CUP' AND abs(COALESCE(tx.amount_cup,0)-COALESCE(t.amount_cup,0))>0.01) OR
       (t.currency='SALDO' AND abs(COALESCE(tx.amount_saldo,0)-COALESCE(t.amount_saldo,0))>0.01))
  ) THEN RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_MISSING' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_refund_tx FROM public.store_wallet_transactions
    WHERE client_id=v_order.client_id AND reference_type='GAME_RECHARGE_REFUND'
      AND reference_id=v_order.id::text AND kind='REFUND' FOR UPDATE;
  IF FOUND THEN
    IF v_refund_tx.currency IS DISTINCT FROM v_currency OR
       (v_currency='CUP' AND abs(COALESCE(v_refund_tx.amount_cup,0)-v_order.payment_amount)>0.01) OR
       (v_currency='SALDO' AND abs(COALESCE(v_refund_tx.amount_saldo,0)-v_order.payment_amount)>0.01) THEN
      RAISE EXCEPTION 'WALLET_REFUND_AMOUNT_MISMATCH' USING ERRCODE='P0001';
    END IF;
    UPDATE public.game_recharge_orders SET status='REFUNDED', wallet_refunded_at=COALESCE(wallet_refunded_at,v_refund_tx.created_at), updated_at=now()
      WHERE id=v_order.id AND (status <> 'REFUNDED' OR wallet_refunded_at IS NULL);
    RETURN jsonb_build_object('already_refunded',true,'status','REFUNDED','currency',v_currency,
      'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo);
  END IF;
  IF v_order.status <> 'REFUND_REQUIRED' THEN RAISE EXCEPTION 'ORDER_NOT_REFUNDABLE' USING ERRCODE='P0001'; END IF;

  IF v_currency='CUP' THEN
    v_balance:=v_wallet.balance_cup+v_order.payment_amount;
    UPDATE public.store_wallets SET balance_cup=v_balance,total_credited_cup=total_credited_cup+v_order.payment_amount,updated_at=now() WHERE client_id=v_order.client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_cup,balance_after_cup,reference_type,reference_id,description)
    VALUES (v_order.client_id,'REFUND','CUP',v_order.payment_amount,v_balance,'GAME_RECHARGE_REFUND',v_order.id::text,'Devolución por fallo de entrega a Wallet CUP');
    v_wallet.balance_cup:=v_balance;
  ELSE
    v_balance:=v_wallet.balance_saldo+v_order.payment_amount;
    UPDATE public.store_wallets SET balance_saldo=v_balance,total_credited_saldo=total_credited_saldo+v_order.payment_amount,updated_at=now() WHERE client_id=v_order.client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_saldo,balance_after_saldo,reference_type,reference_id,description)
    VALUES (v_order.client_id,'REFUND','SALDO',v_order.payment_amount,v_balance,'GAME_RECHARGE_REFUND',v_order.id::text,'Devolución por fallo de entrega a Wallet Saldo Móvil');
    v_wallet.balance_saldo:=v_balance;
  END IF;
  UPDATE public.game_recharge_orders SET status='REFUNDED',wallet_refunded_at=now(),updated_at=now() WHERE id=v_order.id;
  RETURN jsonb_build_object('already_refunded',false,'status','REFUNDED','currency',v_currency,
    'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo,'balance',v_balance);
END;
$$;


-- A completion sentinel prevents the API from exposing cart endpoints when a SQL
-- editor stopped halfway through this migration. The backend requires schema_version=1.
CREATE TABLE IF NOT EXISTS public.store_cart_schema_status (
  id text PRIMARY KEY CHECK (id = 'cart-v1'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_cart_schema_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_cart_schema_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.store_cart_schema_status TO service_role;
INSERT INTO public.store_cart_schema_status (id, schema_version, applied_at)
VALUES ('cart-v1', 1, now())
ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, applied_at = EXCLUDED.applied_at;
