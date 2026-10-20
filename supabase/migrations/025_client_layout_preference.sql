-- Customer-selected interface layout, independent from color theme.
-- Additive/idempotent migration: no profile rows or financial data are removed.
ALTER TABLE public.synthesisone_profiles
  ADD COLUMN IF NOT EXISTS layout_style text NOT NULL DEFAULT 'hybrid';

UPDATE public.synthesisone_profiles
SET layout_style = 'hybrid'
WHERE layout_style IS NULL OR layout_style NOT IN ('hybrid', 'glass', 'minimal');

ALTER TABLE public.synthesisone_profiles
  ALTER COLUMN layout_style SET DEFAULT 'hybrid',
  ALTER COLUMN layout_style SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'synthesisone_profiles_layout_style_check'
      AND conrelid = 'public.synthesisone_profiles'::regclass
  ) THEN
    ALTER TABLE public.synthesisone_profiles
      ADD CONSTRAINT synthesisone_profiles_layout_style_check
      CHECK (layout_style IN ('hybrid', 'glass', 'minimal')) NOT VALID;
  END IF;
END $$;
