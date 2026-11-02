BEGIN;

-- Direct Saldo Móvil Game Market orders are external CUBACEL payments, not Wallet credits.
ALTER TABLE public.game_recharge_orders
  DROP CONSTRAINT IF EXISTS game_recharge_orders_payment_source_check;

ALTER TABLE public.game_recharge_orders
  ADD CONSTRAINT game_recharge_orders_payment_source_check
  CHECK (payment_source IN ('TRANSFERMOVIL', 'WALLET', 'CUBACEL'));

-- Keep the payment source and price currency coupled at the database boundary.
ALTER TABLE public.game_recharge_orders
  DROP CONSTRAINT IF EXISTS game_recharge_orders_payment_currency_check;

ALTER TABLE public.game_recharge_orders
  ADD CONSTRAINT game_recharge_orders_payment_currency_check
  CHECK (
    (payment_source = 'TRANSFERMOVIL' AND price_basis = 'CUP') OR
    (payment_source = 'WALLET' AND price_basis IN ('CUP', 'SALDO')) OR
    (payment_source = 'CUBACEL' AND price_basis = 'SALDO')
  ) NOT VALID;

ALTER TABLE public.game_recharge_orders
  VALIDATE CONSTRAINT game_recharge_orders_payment_currency_check;

-- CUBACEL notifications may not include a bank transaction ID. Ensure one SMS
-- log can settle no more than one Game Market order even if a webhook/device retries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.game_recharge_orders
    WHERE payment_sms_log_id IS NOT NULL AND btrim(payment_sms_log_id) <> ''
    GROUP BY payment_sms_log_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate game_recharge_orders.payment_sms_log_id values exist; resolve them before applying migration 036';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS game_recharge_orders_payment_sms_log_unique_idx
  ON public.game_recharge_orders (payment_sms_log_id)
  WHERE payment_sms_log_id IS NOT NULL AND btrim(payment_sms_log_id) <> '';

COMMENT ON COLUMN public.game_recharge_orders.payment_source IS
  'TRANSFERMOVIL = CUP external transfer; WALLET = internal Wallet debit; CUBACEL = direct Saldo Móvil external transfer.';

COMMIT;
