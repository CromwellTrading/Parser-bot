-- SynthesisOne SO — Wallet payment matching reliability and non-silent review.
-- Apply to the SAME Supabase project used by Parser-bot BEFORE deploying this code.
-- Safe/idempotent: adds nullable diagnostic fields; does not change existing balances.

ALTER TABLE public.store_wallet_topups
  ADD COLUMN IF NOT EXISTS payment_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_review_reason text,
  ADD COLUMN IF NOT EXISTS payment_review_sms_log_id text,
  ADD COLUMN IF NOT EXISTS payment_review_transaction_id text;

CREATE INDEX IF NOT EXISTS store_wallet_topups_review_idx
  ON public.store_wallet_topups (status, payment_review_at)
  WHERE payment_review_at IS NOT NULL;

-- Same atomic/idempotent credit function as migration 017, but clear the review flag
-- in the same transaction as the balance credit and ticket completion.
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
  v_credit public.store_wallet_transactions%ROWTYPE;
  v_balance numeric(18,2);
  v_ledger_net numeric(18,2);
  v_ledger_credited numeric(18,2);
  v_ledger_repaired boolean := false;
  v_same_payment_evidence boolean := false;
BEGIN
  -- The ticket lock serializes webhook retries, scheduled reconciliation and manual refreshes.
  SELECT * INTO v_topup FROM public.store_wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOPUP_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  -- If the wallet row was accidentally removed, reconstruct it from the ledger instead of
  -- creating a misleading zero-balance row. This path never invents new movements.
  INSERT INTO public.store_wallets (client_id, balance_cup, total_credited_cup, total_spent_cup)
  SELECT v_topup.client_id,
    COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN kind = 'SPEND' THEN amount_cup ELSE 0 END),0)
  FROM public.store_wallet_transactions
  WHERE client_id = v_topup.client_id
  ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = v_topup.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_ROW_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup ELSE 0 END),0)
    INTO v_ledger_net, v_ledger_credited
  FROM public.store_wallet_transactions WHERE client_id = v_topup.client_id;

  SELECT * INTO v_credit FROM public.store_wallet_transactions
   WHERE client_id = v_topup.client_id AND kind = 'CREDIT'
     AND reference_type = 'WALLET_TOPUP' AND reference_id = v_topup.id::text
   LIMIT 1;

  v_same_payment_evidence :=
    (NULLIF(p_payment_transaction_id,'') IS NOT NULL AND
      (v_topup.payment_review_transaction_id = p_payment_transaction_id OR v_topup.payment_transaction_id = p_payment_transaction_id))
    OR (NULLIF(p_payment_sms_log_id,'') IS NOT NULL AND
      (v_topup.payment_review_sms_log_id = p_payment_sms_log_id OR v_topup.payment_sms_log_id = p_payment_sms_log_id));

  IF v_topup.status = 'COMPLETED' THEN
    IF FOUND THEN
      IF abs(v_credit.amount_cup - v_topup.amount_cup) > 0.01 THEN
        RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
      END IF;
      -- A correct ticket movement is not enough if the account balance itself drifted.
      -- Preserve the review flag and fail closed instead of falsely reporting success.
      IF abs(v_wallet.balance_cup - v_ledger_net) > 0.01 THEN
        RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- If the wallet already includes this exact verified payment but its audit movement is
      -- missing, restore the ledger entry only; do not add the money to balance a second time.
      IF abs(v_wallet.balance_cup - (v_ledger_net + v_topup.amount_cup)) <= 0.01 AND v_same_payment_evidence THEN
        INSERT INTO public.store_wallet_transactions (
          client_id, kind, amount_cup, balance_after_cup, reference_type, reference_id, description
        ) VALUES (
          v_topup.client_id, 'CREDIT', v_topup.amount_cup, v_wallet.balance_cup,
          'WALLET_TOPUP', v_topup.id::text, 'Reconstrucción idempotente del movimiento de Wallet'
        );
        UPDATE public.store_wallets SET total_credited_cup = GREATEST(total_credited_cup, v_ledger_credited + v_topup.amount_cup), updated_at = now()
         WHERE client_id = v_topup.client_id;
        v_ledger_repaired := true;
      ELSE
        RAISE EXCEPTION 'TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.store_wallet_topups SET
      payment_review_at = NULL, payment_review_reason = NULL,
      payment_review_sms_log_id = NULL, payment_review_transaction_id = NULL,
      updated_at = now()
    WHERE id = p_topup_id AND (payment_review_at IS NOT NULL OR payment_review_reason IS NOT NULL);
    SELECT balance_cup INTO v_balance FROM public.store_wallets WHERE client_id = v_topup.client_id;
    RETURN jsonb_build_object('already_processed', true, 'ledger_repaired', v_ledger_repaired,
      'topup_id', v_topup.id, 'balance_cup', COALESCE(v_balance,0));
  END IF;

  IF v_topup.status NOT IN ('WAITING_PAYMENT','EXPIRED') THEN
    RAISE EXCEPTION 'TOPUP_NOT_PAYABLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_payment_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.store_wallet_topups
    WHERE payment_transaction_id = p_payment_transaction_id AND id <> p_topup_id
  ) THEN RAISE EXCEPTION 'DUPLICATE_PAYMENT_TRANSACTION' USING ERRCODE = '23505'; END IF;

  IF v_credit.id IS NOT NULL THEN
    -- A previous/manual attempt may have written the movement but not finalized the ticket.
    -- Complete the ticket without issuing another credit.
    IF abs(v_credit.amount_cup - v_topup.amount_cup) > 0.01 OR abs(v_wallet.balance_cup - v_ledger_net) > 0.01 THEN
      RAISE EXCEPTION 'WALLET_TOPUP_PARTIAL_STATE_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.store_wallets SET total_credited_cup = GREATEST(total_credited_cup, v_ledger_credited), updated_at = now()
      WHERE client_id = v_topup.client_id;
    UPDATE public.store_wallet_topups SET status = 'COMPLETED', paid_at = COALESCE(paid_at, now()),
      payment_transaction_id = COALESCE(NULLIF(p_payment_transaction_id,''), payment_transaction_id),
      payment_sms_log_id = COALESCE(NULLIF(p_payment_sms_log_id,''), payment_sms_log_id),
      payment_transaction_at = COALESCE(p_payment_transaction_at, payment_transaction_at),
      payment_review_at = NULL, payment_review_reason = NULL,
      payment_review_sms_log_id = NULL, payment_review_transaction_id = NULL, updated_at = now()
    WHERE id = p_topup_id;
    RETURN jsonb_build_object('already_processed', true, 'ledger_repaired', false,
      'topup_id', v_topup.id, 'balance_cup', v_wallet.balance_cup);
  END IF;

  IF abs(v_wallet.balance_cup - (v_ledger_net + v_topup.amount_cup)) <= 0.01 AND v_same_payment_evidence THEN
    -- The exact payment evidence was already attached to this ticket and its amount is already
    -- reflected in balance; repair only the missing ledger/state so we do not credit twice.
    INSERT INTO public.store_wallet_transactions (
      client_id, kind, amount_cup, balance_after_cup, reference_type, reference_id, description
    ) VALUES (
      v_topup.client_id, 'CREDIT', v_topup.amount_cup, v_wallet.balance_cup,
      'WALLET_TOPUP', v_topup.id::text, 'Reconciliación idempotente de recarga Wallet'
    );
    UPDATE public.store_wallets SET total_credited_cup = GREATEST(total_credited_cup, v_ledger_credited + v_topup.amount_cup), updated_at = now()
      WHERE client_id = v_topup.client_id;
    v_balance := v_wallet.balance_cup;
    v_ledger_repaired := true;
  ELSIF abs(v_wallet.balance_cup - (v_ledger_net + v_topup.amount_cup)) <= 0.01 THEN
    -- Balance happens to differ by this amount but this ticket has no matching stored evidence;
    -- refuse to infer a prior credit from arithmetic alone.
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
  ELSIF abs(v_wallet.balance_cup - v_ledger_net) <= 0.01 THEN
    -- Normal atomic credit: only run when stored balance and the ledger agree.
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
  ELSE
    -- Fail closed on unrelated balance/ledger discrepancies rather than risking a duplicate credit.
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.store_wallet_topups SET status = 'COMPLETED', paid_at = COALESCE(paid_at, now()),
    payment_transaction_id = COALESCE(NULLIF(p_payment_transaction_id,''), payment_transaction_id),
    payment_sms_log_id = COALESCE(NULLIF(p_payment_sms_log_id,''), payment_sms_log_id),
    payment_transaction_at = COALESCE(p_payment_transaction_at, payment_transaction_at),
    payment_review_at = NULL, payment_review_reason = NULL,
    payment_review_sms_log_id = NULL, payment_review_transaction_id = NULL,
    updated_at = now()
    WHERE id = p_topup_id;

  RETURN jsonb_build_object('already_processed', false, 'ledger_repaired', v_ledger_repaired,
    'topup_id', v_topup.id, 'balance_cup', v_balance);
END;
$$;
-- Do not allow purchases to proceed while stored balance and the append-only ledger disagree.
-- This prevents spending a balance that may be displaying the wrong value during reconciliation.
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
  v_ledger_net numeric(18,2);
  v_order_id uuid;
  v_existing public.store_wallet_transactions%ROWTYPE;
  v_order public.game_recharge_orders%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(length(trim(p_idempotency_key)),0) < 8 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  -- Rebuild a missing account row from movements. Never create a false zero-balance wallet.
  INSERT INTO public.store_wallets (client_id, balance_cup, total_credited_cup, total_spent_cup)
  SELECT p_client_id,
    COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN kind = 'SPEND' THEN amount_cup ELSE 0 END),0)
  FROM public.store_wallet_transactions WHERE client_id = p_client_id
  ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.store_wallets WHERE client_id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_ROW_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(SUM(CASE WHEN kind IN ('CREDIT','REFUND') THEN amount_cup
                           WHEN kind = 'SPEND' THEN -amount_cup ELSE 0 END),0)
    INTO v_ledger_net
    FROM public.store_wallet_transactions WHERE client_id = p_client_id;
  IF abs(v_wallet.balance_cup - v_ledger_net) > 0.01 THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_topups t
    LEFT JOIN public.store_wallet_transactions tx
      ON tx.client_id = t.client_id AND tx.kind = 'CREDIT'
     AND tx.reference_type = 'WALLET_TOPUP' AND tx.reference_id = t.id::text
    WHERE t.client_id = p_client_id AND t.status = 'COMPLETED'
      AND (tx.id IS NULL OR abs(tx.amount_cup - t.amount_cup) > 0.01)
  ) THEN
    RAISE EXCEPTION 'WALLET_TOPUP_LEDGER_MISSING' USING ERRCODE = 'P0001';
  END IF;

  -- Return the *current* locked balance for idempotent retries, not the historical
  -- balance_after_cup snapshot from when the original purchase happened.
  SELECT * INTO v_existing FROM public.store_wallet_transactions
    WHERE client_id = p_client_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reference_type <> 'GAME_RECHARGE' THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO v_order FROM public.game_recharge_orders WHERE id = v_existing.reference_id::uuid;
    RETURN jsonb_build_object('already_processed', true, 'order', to_jsonb(v_order), 'balance_cup', v_wallet.balance_cup);
  END IF;

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
    NULLIF(p_order->>'provider_region_slug',''), NULLIF(p_order->>'provider_region_name',''),
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

-- A refund is a credit too: refuse to create one while Wallet integrity is uncertain.
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
BEGIN
  SELECT * INTO v_order FROM public.game_recharge_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_order.payment_source <> 'WALLET' OR v_order.status <> 'REFUND_REQUIRED' THEN
    RAISE EXCEPTION 'ORDER_NOT_REFUNDABLE' USING ERRCODE = 'P0001';
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

-- Verification: review columns must exist after applying the migration.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'store_wallet_topups'
  AND column_name IN ('payment_review_at','payment_review_reason','payment_review_sms_log_id','payment_review_transaction_id')
ORDER BY column_name;
