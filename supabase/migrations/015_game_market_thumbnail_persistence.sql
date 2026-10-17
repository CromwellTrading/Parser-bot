-- Reliable permanent thumbnails for SynthesisOne Game Market.
-- Safe to run repeatedly in the Supabase project used by the backend.

ALTER TABLE public.game_market_games
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'so-game-thumbnails',
  'so-game-thumbnails',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'SynthesisOne game thumbnails are publicly readable'
  ) THEN
    CREATE POLICY "SynthesisOne game thumbnails are publicly readable"
      ON storage.objects FOR SELECT TO anon, authenticated
      USING (bucket_id = 'so-game-thumbnails');
  END IF;
END $$;

COMMENT ON COLUMN public.game_market_games.thumbnail_url IS
  'Provider/Wikimedia thumbnail fallback URL; uploaded thumbnail_path takes precedence.';

-- Verification: confirms the DB column and persistent public bucket are ready.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'game_market_games'
  AND column_name IN ('thumbnail_path', 'thumbnail_url')
ORDER BY column_name;

SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id = 'so-game-thumbnails';
