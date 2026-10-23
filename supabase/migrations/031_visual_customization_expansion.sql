-- SynthesisOne: enable all seven interface designs and seven color palettes.
-- Additive preference-only change. Does not alter purchases, wallet balances, licenses or rewards.

ALTER TABLE public.synthesisone_profiles
  ADD COLUMN IF NOT EXISTS layout_style text NOT NULL DEFAULT 'hybrid';

-- Normalize any legacy or unexpected preference before applying the expanded constraints.
UPDATE public.synthesisone_profiles
SET theme = 'violet'
WHERE theme IS NULL OR theme NOT IN ('violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean');

UPDATE public.synthesisone_profiles
SET layout_style = 'hybrid'
WHERE layout_style IS NULL OR layout_style NOT IN ('hybrid', 'professional', 'glass', 'minimal', 'aurora', 'arena', 'soft');

ALTER TABLE public.synthesisone_profiles
  ALTER COLUMN theme SET DEFAULT 'violet',
  ALTER COLUMN theme SET NOT NULL,
  ALTER COLUMN layout_style SET DEFAULT 'hybrid',
  ALTER COLUMN layout_style SET NOT NULL;

ALTER TABLE public.synthesisone_profiles
  DROP CONSTRAINT IF EXISTS synthesisone_profiles_theme_check;
ALTER TABLE public.synthesisone_profiles
  ADD CONSTRAINT synthesisone_profiles_theme_check
  CHECK (theme IN ('violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean')) NOT VALID;

ALTER TABLE public.synthesisone_profiles
  DROP CONSTRAINT IF EXISTS synthesisone_profiles_layout_style_check;
ALTER TABLE public.synthesisone_profiles
  ADD CONSTRAINT synthesisone_profiles_layout_style_check
  CHECK (layout_style IN ('hybrid', 'professional', 'glass', 'minimal', 'aurora', 'arena', 'soft')) NOT VALID;
