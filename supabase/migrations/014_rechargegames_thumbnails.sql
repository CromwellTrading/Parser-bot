-- Store provider/API or Wikimedia thumbnail URLs separately from uploaded images.
-- An uploaded image (thumbnail_path) takes precedence in the API response.
ALTER TABLE public.game_market_games
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMENT ON COLUMN public.game_market_games.thumbnail_url IS
  'HTTPS fallback thumbnail URL discovered from provider metadata or Wikimedia; uploaded thumbnail_path takes precedence.';
