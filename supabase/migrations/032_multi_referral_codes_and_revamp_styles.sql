-- SynthesisOne 032: multi-code referral coupons and expanded revamp visual styles.
-- Apply to the SAME production Supabase project before deploying this backend.
-- Additive migration: does not modify balances, orders, licenses, SMS, or existing coupons.

CREATE TABLE IF NOT EXISTS public.reward_referral_code_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referrer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_referral_code_entries_not_self CHECK (client_id <> referrer_client_id),
  CONSTRAINT reward_referral_code_entries_once UNIQUE (client_id, referrer_client_id)
);
CREATE INDEX IF NOT EXISTS reward_referral_code_entries_owner_idx
  ON public.reward_referral_code_entries (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reward_referral_code_entries_reverse_idx
  ON public.reward_referral_code_entries (referrer_client_id, client_id);
ALTER TABLE public.reward_referral_code_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reward_referral_code_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.reward_referral_code_entries TO service_role;
COMMENT ON TABLE public.reward_referral_code_entries IS 'Unique referral codes entered by each client for entry coupons and every-15-code milestones. It does not change the single paid-referral attribution.';

-- Ensure the preference column exists even if an older deployment skipped migration 031.
-- This is additive and preserves existing profile values.
ALTER TABLE public.synthesisone_profiles
  ADD COLUMN IF NOT EXISTS layout_style text NOT NULL DEFAULT 'hybrid';

-- Add the five strongly distinct design profiles shown in the combined revamp.
ALTER TABLE public.synthesisone_profiles DROP CONSTRAINT IF EXISTS synthesisone_profiles_layout_style_check;
ALTER TABLE public.synthesisone_profiles ADD CONSTRAINT synthesisone_profiles_layout_style_check
  CHECK (layout_style IN ('hybrid', 'professional', 'glass', 'minimal', 'aurora', 'arena', 'soft', 'imperial', 'fuego', 'voltaje', 'nebulosa', 'porcelana')) NOT VALID;

-- The black AMOLED palette is independent from the chosen design profile.
UPDATE public.synthesisone_profiles SET theme='violet' WHERE theme IS NULL OR theme NOT IN ('violet','light','red','green','cyan','gold','ocean','amoled');
ALTER TABLE public.synthesisone_profiles ALTER COLUMN theme SET DEFAULT 'violet';
ALTER TABLE public.synthesisone_profiles DROP CONSTRAINT IF EXISTS synthesisone_profiles_theme_check;
ALTER TABLE public.synthesisone_profiles ADD CONSTRAINT synthesisone_profiles_theme_check
  CHECK (theme IN ('violet','light','red','green','cyan','gold','ocean','amoled')) NOT VALID;

