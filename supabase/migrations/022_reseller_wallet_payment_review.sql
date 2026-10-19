-- Automatically detect a qualifying 50,000 CUP Wallet top-up for a reseller applicant,
-- but never activate the account automatically. A human admin must still verify it.
ALTER TABLE public.reseller_applications
  ADD COLUMN IF NOT EXISTS deposit_payment_status text NOT NULL DEFAULT 'NOT_DETECTED',
  ADD COLUMN IF NOT EXISTS deposit_topup_id uuid,
  ADD COLUMN IF NOT EXISTS deposit_transaction_id text,
  ADD COLUMN IF NOT EXISTS deposit_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_reviewed_by text,
  ADD COLUMN IF NOT EXISTS deposit_reviewed_at timestamptz;

ALTER TABLE public.reseller_profiles
  ADD COLUMN IF NOT EXISTS deposit_payment_status text NOT NULL DEFAULT 'NOT_DETECTED',
  ADD COLUMN IF NOT EXISTS deposit_topup_id uuid,
  ADD COLUMN IF NOT EXISTS deposit_transaction_id text,
  ADD COLUMN IF NOT EXISTS deposit_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_reviewed_by text,
  ADD COLUMN IF NOT EXISTS deposit_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reseller_applications_deposit_payment_status_check') THEN
    ALTER TABLE public.reseller_applications ADD CONSTRAINT reseller_applications_deposit_payment_status_check
      CHECK (deposit_payment_status IN ('NOT_DETECTED', 'PAYMENT_DETECTED_PENDING_ADMIN', 'APPROVED', 'REJECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reseller_profiles_deposit_payment_status_check') THEN
    ALTER TABLE public.reseller_profiles ADD CONSTRAINT reseller_profiles_deposit_payment_status_check
      CHECK (deposit_payment_status IN ('NOT_DETECTED', 'PAYMENT_DETECTED_PENDING_ADMIN', 'APPROVED', 'REJECTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reseller_applications_deposit_pending_idx
  ON public.reseller_applications (status, deposit_payment_status, deposit_detected_at DESC);
