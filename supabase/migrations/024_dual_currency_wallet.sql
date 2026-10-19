BEGIN;

-- SynthesisOne SO — independent CUP and Saldo Móvil Wallet ledgers.
-- Apply after migrations 017–023 in the SAME Supabase project used by Render.
-- Legacy CUP balances and transactions remain unchanged; SALDO never converts to CUP.

ALTER TABLE public.store_wallets
  ADD COLUMN IF NOT EXISTS balance_saldo numeric(18,2) NOT NULL DEFAULT 0 CHECK (balance_saldo >= 0),
  ADD COLUMN IF NOT EXISTS total_credited_saldo numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_credited_saldo >= 0),
  ADD COLUMN IF NOT EXISTS total_spent_saldo numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_spent_saldo >= 0);

ALTER TABLE public.store_wallet_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CUP',
  ADD COLUMN IF NOT EXISTS amount_saldo numeric(18,2),
  ADD COLUMN IF NOT EXISTS balance_after_saldo numeric(18,2);

ALTER TABLE public.store_wallet_transactions ALTER COLUMN amount_cup DROP NOT NULL;
ALTER TABLE public.store_wallet_transactions ALTER COLUMN balance_after_cup DROP NOT NULL;
ALTER TABLE public.store_wallet_transactions DROP CONSTRAINT IF EXISTS store_wallet_transactions_amount_cup_check;
ALTER TABLE public.store_wallet_transactions DROP CONSTRAINT IF EXISTS store_wallet_transactions_balance_after_cup_check;
ALTER TABLE public.store_wallet_transactions DROP CONSTRAINT IF EXISTS store_wallet_transactions_currency_check;
ALTER TABLE public.store_wallet_transactions DROP CONSTRAINT IF EXISTS store_wallet_transactions_amount_by_currency_check;
ALTER TABLE public.store_wallet_transactions ADD CONSTRAINT store_wallet_transactions_currency_check CHECK (currency IN ('CUP','SALDO'));
ALTER TABLE public.store_wallet_transactions ADD CONSTRAINT store_wallet_transactions_amount_by_currency_check CHECK (
  (currency = 'CUP' AND amount_cup > 0 AND balance_after_cup >= 0 AND amount_saldo IS NULL AND balance_after_saldo IS NULL)
  OR
  (currency = 'SALDO' AND amount_saldo > 0 AND balance_after_saldo >= 0 AND amount_cup IS NULL AND balance_after_cup IS NULL)
);

ALTER TABLE public.store_wallet_topups
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CUP',
  ADD COLUMN IF NOT EXISTS amount_saldo numeric(18,2);
ALTER TABLE public.store_wallet_topups ALTER COLUMN amount_cup DROP NOT NULL;
ALTER TABLE public.store_wallet_topups ALTER COLUMN destination_card DROP NOT NULL;
ALTER TABLE public.store_wallet_topups DROP CONSTRAINT IF EXISTS store_wallet_topups_amount_cup_check;
ALTER TABLE public.store_wallet_topups DROP CONSTRAINT IF EXISTS store_wallet_topups_currency_check;
ALTER TABLE public.store_wallet_topups DROP CONSTRAINT IF EXISTS store_wallet_topups_amount_by_currency_check;
ALTER TABLE public.store_wallet_topups ADD CONSTRAINT store_wallet_topups_currency_check CHECK (currency IN ('CUP','SALDO'));
ALTER TABLE public.store_wallet_topups ADD CONSTRAINT store_wallet_topups_amount_by_currency_check CHECK (
  (currency = 'CUP' AND amount_cup > 0 AND amount_saldo IS NULL AND destination_card IS NOT NULL)
  OR
  (currency = 'SALDO' AND amount_saldo > 0 AND amount_cup IS NULL AND destination_card IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS store_wallet_topups_payment_sms_log_unique_idx
  ON public.store_wallet_topups (payment_sms_log_id)
  WHERE payment_sms_log_id IS NOT NULL AND payment_sms_log_id <> '';

COMMENT ON COLUMN public.store_wallets.balance_cup IS 'Customer Wallet CUP ledger balance. Independent from Saldo Móvil.';
COMMENT ON COLUMN public.store_wallets.balance_saldo IS 'Customer Wallet Saldo Móvil units. Never converted to CUP.';
COMMENT ON COLUMN public.store_wallet_transactions.currency IS 'Independent ledger currency: CUP or SALDO.';
COMMENT ON COLUMN public.store_wallet_topups.currency IS 'Currency requested by the customer; credited only after a matching provider SMS.';
COMMENT ON TABLE public.store_wallets IS 'SynthesisOne customer Wallet with independent CUP and Saldo Móvil balances.';
COMMENT ON TABLE public.store_wallet_transactions IS 'Append-only ledger with separate CUP and Saldo Móvil movements, checked independently.';
COMMENT ON TABLE public.store_wallet_topups IS 'CUP Transfermóvil and Saldo Móvil CUBACEL deposits; credits require matching SMS evidence.';

-- Atomic credit for either currency. It preserves the old RPC signature so deployed clients
-- and existing reconciliation code continue to work; currency is read from the immutable ticket.
CREATE OR REPLACE FUNCTION public.store_wallet_credit_topup(
  p_topup_id uuid,
  p_payment_transaction_id text DEFAULT NULL,
  p_payment_sms_log_id text DEFAULT NULL,
  p_payment_transaction_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_topup public.store_wallet_topups%ROWTYPE;
  v_wallet public.store_wallets%ROWTYPE;
  v_credit public.store_wallet_transactions%ROWTYPE;
  v_currency text;
  v_amount numeric(18,2);
  v_balance numeric(18,2);
  v_balance_cup numeric(18,2);
  v_balance_saldo numeric(18,2);
  v_ledger_cup numeric(18,2);
  v_ledger_saldo numeric(18,2);
  v_same_evidence boolean := false;
BEGIN
  SELECT * INTO v_topup FROM public.store_wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOPUP_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  v_currency := COALESCE(v_topup.currency, 'CUP');
  v_amount := CASE WHEN v_currency = 'SALDO' THEN v_topup.amount_saldo ELSE v_topup.amount_cup END;
  IF v_currency NOT IN ('CUP','SALDO') OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'TOPUP_CURRENCY_AMOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.store_wallets (client_id) VALUES (v_topup.client_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = v_topup.client_id FOR UPDATE;
  SELECT
    COALESCE(SUM(CASE WHEN currency = 'CUP' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN currency = 'SALDO' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_saldo WHEN kind = 'SPEND' THEN -amount_saldo ELSE 0 END ELSE 0 END),0)
  INTO v_ledger_cup, v_ledger_saldo
  FROM public.store_wallet_transactions WHERE client_id = v_topup.client_id;

  v_same_evidence :=
    (NULLIF(p_payment_transaction_id,'') IS NOT NULL AND (v_topup.payment_transaction_id = p_payment_transaction_id OR v_topup.payment_review_transaction_id = p_payment_transaction_id))
    OR (NULLIF(p_payment_sms_log_id,'') IS NOT NULL AND (v_topup.payment_sms_log_id = p_payment_sms_log_id OR v_topup.payment_review_sms_log_id = p_payment_sms_log_id));

  SELECT * INTO v_credit FROM public.store_wallet_transactions
   WHERE client_id = v_topup.client_id AND reference_type = 'WALLET_TOPUP' AND reference_id = v_topup.id::text;

  IF v_topup.status = 'COMPLETED' THEN
    IF v_credit.id IS NOT NULL THEN
      IF v_credit.currency IS DISTINCT FROM v_currency OR
         (v_currency = 'CUP' AND abs(COALESCE(v_credit.amount_cup,0) - v_amount) > 0.01) OR
         (v_currency = 'SALDO' AND abs(COALESCE(v_credit.amount_saldo,0) - v_amount) > 0.01) OR
         abs(v_wallet.balance_cup - v_ledger_cup) > 0.01 OR abs(v_wallet.balance_saldo - v_ledger_saldo) > 0.01 THEN
        RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF NOT v_same_evidence THEN RAISE EXCEPTION 'TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED' USING ERRCODE = 'P0001'; END IF;
      IF v_currency = 'CUP' AND abs(v_wallet.balance_cup - (v_ledger_cup + v_amount)) <= 0.01 AND abs(v_wallet.balance_saldo - v_ledger_saldo) <= 0.01 THEN
        INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_cup,balance_after_cup,reference_type,reference_id,description)
        VALUES (v_topup.client_id,'CREDIT','CUP',v_amount,v_wallet.balance_cup,'WALLET_TOPUP',v_topup.id::text,'Reconstrucción del libro de Wallet CUP');
        UPDATE public.store_wallets SET total_credited_cup = GREATEST(total_credited_cup, v_ledger_cup + v_amount), updated_at = now() WHERE client_id = v_topup.client_id;
      ELSIF v_currency = 'SALDO' AND abs(v_wallet.balance_saldo - (v_ledger_saldo + v_amount)) <= 0.01 AND abs(v_wallet.balance_cup - v_ledger_cup) <= 0.01 THEN
        INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_saldo,balance_after_saldo,reference_type,reference_id,description)
        VALUES (v_topup.client_id,'CREDIT','SALDO',v_amount,v_wallet.balance_saldo,'WALLET_TOPUP',v_topup.id::text,'Reconstrucción del libro de Wallet Saldo Móvil');
        UPDATE public.store_wallets SET total_credited_saldo = GREATEST(total_credited_saldo, v_ledger_saldo + v_amount), updated_at = now() WHERE client_id = v_topup.client_id;
      ELSE
        RAISE EXCEPTION 'TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.store_wallet_topups SET payment_review_at = NULL, payment_review_reason = NULL,
      payment_review_sms_log_id = NULL, payment_review_transaction_id = NULL, updated_at = now() WHERE id = p_topup_id;
    RETURN jsonb_build_object('already_processed',true,'topup_id',v_topup.id,'currency',v_currency,
      'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo);
  END IF;

  IF v_topup.status NOT IN ('WAITING_PAYMENT','EXPIRED') THEN RAISE EXCEPTION 'TOPUP_NOT_PAYABLE' USING ERRCODE = 'P0001'; END IF;
  IF NULLIF(p_payment_transaction_id,'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_wallet_topups WHERE payment_transaction_id = p_payment_transaction_id AND id <> p_topup_id
  ) THEN RAISE EXCEPTION 'DUPLICATE_PAYMENT_TRANSACTION' USING ERRCODE = '23505'; END IF;
  IF NULLIF(p_payment_sms_log_id,'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_wallet_topups WHERE payment_sms_log_id = p_payment_sms_log_id AND id <> p_topup_id
  ) THEN RAISE EXCEPTION 'DUPLICATE_PAYMENT_SMS' USING ERRCODE = '23505'; END IF;

  IF abs(v_wallet.balance_cup - v_ledger_cup) > 0.01 OR abs(v_wallet.balance_saldo - v_ledger_saldo) > 0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_credit.id IS NOT NULL THEN
    IF v_credit.currency IS DISTINCT FROM v_currency OR
       (v_currency = 'CUP' AND abs(COALESCE(v_credit.amount_cup,0)-v_amount)>0.01) OR
       (v_currency = 'SALDO' AND abs(COALESCE(v_credit.amount_saldo,0)-v_amount)>0.01) THEN
      RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.store_wallet_topups SET status='COMPLETED', paid_at=COALESCE(paid_at,now()),
      payment_transaction_id=COALESCE(NULLIF(p_payment_transaction_id,''),payment_transaction_id),
      payment_sms_log_id=COALESCE(NULLIF(p_payment_sms_log_id,''),payment_sms_log_id),
      payment_transaction_at=COALESCE(p_payment_transaction_at,payment_transaction_at),
      payment_review_at=NULL,payment_review_reason=NULL,payment_review_sms_log_id=NULL,payment_review_transaction_id=NULL,updated_at=now()
      WHERE id=p_topup_id;
    RETURN jsonb_build_object('already_processed',true,'topup_id',v_topup.id,'currency',v_currency,
      'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo);
  END IF;

  IF v_currency = 'CUP' THEN
    v_balance := v_wallet.balance_cup + v_amount;
    UPDATE public.store_wallets SET balance_cup=v_balance,total_credited_cup=total_credited_cup+v_amount,updated_at=now() WHERE client_id=v_topup.client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_cup,balance_after_cup,reference_type,reference_id,description)
    VALUES (v_topup.client_id,'CREDIT','CUP',v_amount,v_balance,'WALLET_TOPUP',v_topup.id::text,'Fondos CUP añadidos a Wallet');
    v_balance_cup := v_balance; v_balance_saldo := v_wallet.balance_saldo;
  ELSE
    v_balance := v_wallet.balance_saldo + v_amount;
    UPDATE public.store_wallets SET balance_saldo=v_balance,total_credited_saldo=total_credited_saldo+v_amount,updated_at=now() WHERE client_id=v_topup.client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_saldo,balance_after_saldo,reference_type,reference_id,description)
    VALUES (v_topup.client_id,'CREDIT','SALDO',v_amount,v_balance,'WALLET_TOPUP',v_topup.id::text,'Fondos Saldo Móvil añadidos a Wallet');
    v_balance_cup := v_wallet.balance_cup; v_balance_saldo := v_balance;
  END IF;

  UPDATE public.store_wallet_topups SET status='COMPLETED',paid_at=COALESCE(paid_at,now()),
    payment_transaction_id=COALESCE(NULLIF(p_payment_transaction_id,''),payment_transaction_id),
    payment_sms_log_id=COALESCE(NULLIF(p_payment_sms_log_id,''),payment_sms_log_id),
    payment_transaction_at=COALESCE(p_payment_transaction_at,payment_transaction_at),
    payment_review_at=NULL,payment_review_reason=NULL,payment_review_sms_log_id=NULL,payment_review_transaction_id=NULL,updated_at=now()
    WHERE id=p_topup_id;
  RETURN jsonb_build_object('already_processed',false,'topup_id',v_topup.id,'currency',v_currency,
    'balance_cup',v_balance_cup,'balance_saldo',v_balance_saldo);
END;
$$;

-- Atomically reserve only the selected currency, validate both ledgers, and create the order.
CREATE OR REPLACE FUNCTION public.store_wallet_create_game_order(
  p_client_id uuid, p_amount numeric, p_order jsonb, p_idempotency_key text, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.store_wallets%ROWTYPE;
  v_order public.game_recharge_orders%ROWTYPE;
  v_existing public.store_wallet_transactions%ROWTYPE;
  v_order_id uuid;
  v_balance numeric(18,2);
  v_ledger_cup numeric(18,2);
  v_ledger_saldo numeric(18,2);
  v_currency text := upper(trim(COALESCE(p_currency,'CUP')));
  v_now timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF v_currency NOT IN ('CUP','SALDO') THEN RAISE EXCEPTION 'INVALID_WALLET_CURRENCY' USING ERRCODE='P0001'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE='P0001'; END IF;
  IF COALESCE(length(trim(p_idempotency_key)),0)<8 OR length(p_idempotency_key)>128 THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE='P0001'; END IF;
  IF upper(COALESCE(p_order->>'price_basis','')) <> v_currency THEN RAISE EXCEPTION 'ORDER_CURRENCY_MISMATCH' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.store_wallets (client_id) VALUES (p_client_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id=p_client_id FOR UPDATE;
  SELECT
    COALESCE(SUM(CASE WHEN currency='CUP' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind='SPEND' THEN -amount_cup ELSE 0 END ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN currency='SALDO' THEN CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_saldo WHEN kind='SPEND' THEN -amount_saldo ELSE 0 END ELSE 0 END),0)
  INTO v_ledger_cup,v_ledger_saldo FROM public.store_wallet_transactions WHERE client_id=p_client_id;
  IF abs(v_wallet.balance_cup-v_ledger_cup)>0.01 OR abs(v_wallet.balance_saldo-v_ledger_saldo)>0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE='P0001';
  END IF;
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
    IF v_existing.reference_type <> 'GAME_RECHARGE' OR v_existing.currency IS DISTINCT FROM v_currency THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='P0001'; END IF;
    SELECT * INTO v_order FROM public.game_recharge_orders WHERE id=v_existing.reference_id::uuid;
    RETURN jsonb_build_object('already_processed',true,'order',to_jsonb(v_order),
      'currency',v_currency,'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo,
      'balance',CASE WHEN v_currency='CUP' THEN v_wallet.balance_cup ELSE v_wallet.balance_saldo END);
  END IF;

  IF v_currency='CUP' AND v_wallet.balance_cup<p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE='P0001'; END IF;
  IF v_currency='SALDO' AND v_wallet.balance_saldo<p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE='P0001'; END IF;
  v_order_id := (p_order->>'id')::uuid;
  IF EXISTS (SELECT 1 FROM public.game_recharge_orders WHERE id=v_order_id) THEN RAISE EXCEPTION 'ORDER_ALREADY_EXISTS' USING ERRCODE='23505'; END IF;

  INSERT INTO public.game_recharge_orders (
    id,client_id,offer_id,game_name,offer_title,provider_product_key,provider_product_name,
    provider_game_slug,provider_region_slug,provider_region_name,provider_delivery,provider_kind,
    provider_cost_usdt,price_basis,payment_amount,payer_phone,destination_card,confirmation_phone,
    status,buyer_ref,player_id,server_id,created_at,updated_at,payment_deadline_at,paid_at,payment_source
  ) VALUES (
    v_order_id,p_client_id,(p_order->>'offer_id')::uuid,p_order->>'game_name',p_order->>'offer_title',
    p_order->>'provider_product_key',p_order->>'provider_product_name',p_order->>'provider_game_slug',
    NULLIF(p_order->>'provider_region_slug',''),NULLIF(p_order->>'provider_region_name',''),
    p_order->>'provider_delivery',COALESCE(NULLIF(p_order->>'provider_kind',''),'topup'),
    (p_order->>'provider_cost_usdt')::numeric,v_currency,p_amount,NULL,NULL,NULL,
    'SUBMITTING_TO_PROVIDER',p_order->>'buyer_ref',NULLIF(p_order->>'player_id',''),NULLIF(p_order->>'server_id',''),
    v_now,v_now,v_now+interval '30 minutes',v_now,'WALLET'
  ) RETURNING * INTO v_order;

  IF v_currency='CUP' THEN
    v_balance:=v_wallet.balance_cup-p_amount;
    UPDATE public.store_wallets SET balance_cup=v_balance,total_spent_cup=total_spent_cup+p_amount,updated_at=now() WHERE client_id=p_client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_cup,balance_after_cup,reference_type,reference_id,idempotency_key,description)
    VALUES (p_client_id,'SPEND','CUP',p_amount,v_balance,'GAME_RECHARGE',v_order_id::text,p_idempotency_key,'Compra Game Market con Wallet CUP');
    v_wallet.balance_cup:=v_balance;
  ELSE
    v_balance:=v_wallet.balance_saldo-p_amount;
    UPDATE public.store_wallets SET balance_saldo=v_balance,total_spent_saldo=total_spent_saldo+p_amount,updated_at=now() WHERE client_id=p_client_id;
    INSERT INTO public.store_wallet_transactions (client_id,kind,currency,amount_saldo,balance_after_saldo,reference_type,reference_id,idempotency_key,description)
    VALUES (p_client_id,'SPEND','SALDO',p_amount,v_balance,'GAME_RECHARGE',v_order_id::text,p_idempotency_key,'Compra Game Market con Wallet Saldo Móvil');
    v_wallet.balance_saldo:=v_balance;
  END IF;
  RETURN jsonb_build_object('already_processed',false,'order',to_jsonb(v_order),'currency',v_currency,
    'balance_cup',v_wallet.balance_cup,'balance_saldo',v_wallet.balance_saldo,'balance',v_balance);
END;
$$;

-- Keep callers on the original 4-argument RPC signature working as CUP-only purchases.
CREATE OR REPLACE FUNCTION public.store_wallet_create_game_order(
  p_client_id uuid, p_amount numeric, p_order jsonb, p_idempotency_key text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.store_wallet_create_game_order(p_client_id,p_amount,p_order,p_idempotency_key,'CUP');
$$;

-- Refund a provider-confirmed failed delivery back to the same currency that was debited.
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

REVOKE ALL ON FUNCTION public.store_wallet_credit_topup(uuid,text,text,timestamptz) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text,text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.store_wallet_refund_game_order(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_wallet_credit_topup(uuid,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_wallet_refund_game_order(uuid) TO service_role;

COMMENT ON FUNCTION public.store_wallet_create_game_order(uuid,numeric,jsonb,text,text) IS 'Atomically debits CUP or Saldo Móvil from the matching independent Wallet ledger before creating a Game Market order.';

COMMIT;
