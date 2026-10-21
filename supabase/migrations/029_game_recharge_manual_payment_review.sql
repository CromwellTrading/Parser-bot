BEGIN;

-- Audit trail for an administrator who verifies a transfer manually and asks
-- the existing order pipeline to submit/reconcile the provider order.
ALTER TABLE public.game_recharge_orders
  ADD COLUMN IF NOT EXISTS payment_manual_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_manual_confirmed_by text,
  ADD COLUMN IF NOT EXISTS payment_manual_confirmation_note text;

CREATE INDEX IF NOT EXISTS idx_game_recharge_orders_payment_review
  ON public.game_recharge_orders (status, created_at DESC)
  WHERE status IN (
    'WAITING_PAYMENT',
    'EXPIRED',
    'PAYMENT_RECEIVED_WAITING_DETAILS',
    'SUBMITTING_TO_PROVIDER',
    'PROCESSING',
    'FULFILLMENT_REVIEW',
    'PAID',
    'COMPLETED'
  );

COMMENT ON COLUMN public.game_recharge_orders.payment_manual_confirmed_at IS
  'Timestamp when an administrator verified a transfer manually through the authenticated review route.';
COMMENT ON COLUMN public.game_recharge_orders.payment_manual_confirmed_by IS
  'Client/admin identifier that confirmed the transfer manually.';
COMMENT ON COLUMN public.game_recharge_orders.payment_manual_confirmation_note IS
  'Sanitized administrative note for a manual transfer verification.';

COMMIT;
