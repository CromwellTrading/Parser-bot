-- SynthesisOne visual customization expansion.
-- Run in the same Supabase project used by the deployed Parser-bot backend.
-- Additive preference-only migration; financial, license, SMS and order data are untouched.

ALTER TABLE public.synthesisone_profiles
  ADD COLUMN IF NOT EXISTS layout_style text NOT NULL DEFAULT 'hybrid';

-- Normalize legacy/unrecognized values before applying the expanded checks.
UPDATE public.synthesisone_profiles
SET theme = 'violet'
WHERE theme IS NULL OR theme NOT IN ('violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean');

UPDATE public.synthesisone_profiles
SET layout_style = 'hybrid'
WHERE layout_style IS NULL OR layout_style NOT IN ('hybrid', 'glass', 'minimal', 'professional', 'aurora', 'arena', 'soft');

ALTER TABLE public.synthesisone_profiles
  ALTER COLUMN theme SET DEFAULT 'violet',
  ALTER COLUMN theme SET NOT NULL,
  ALTER COLUMN layout_style SET DEFAULT 'hybrid',
  ALTER COLUMN layout_style SET NOT NULL;

-- Replace old allow-lists so the API can persist newly introduced themes/styles.
ALTER TABLE public.synthesisone_profiles
  DROP CONSTRAINT IF EXISTS synthesisone_profiles_theme_check;
ALTER TABLE public.synthesisone_profiles
  ADD CONSTRAINT synthesisone_profiles_theme_check
  CHECK (theme IN ('violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean')) NOT VALID;

ALTER TABLE public.synthesisone_profiles
  DROP CONSTRAINT IF EXISTS synthesisone_profiles_layout_style_check;
ALTER TABLE public.synthesisone_profiles
  ADD CONSTRAINT synthesisone_profiles_layout_style_check
  CHECK (layout_style IN ('hybrid', 'glass', 'minimal', 'professional', 'aurora', 'arena', 'soft')) NOT VALID;
