-- Ensure Game Market's runtime pricing keys exist on deployments that applied only
-- 009_profiles_game_market.sql. Copy the already-persisted store rule instead of
-- inventing exchange rates. Existing tier-specific settings are preserved.
INSERT INTO public.synthesisone_settings (key, value, updated_at)
SELECT target.key, source.value, now()
FROM public.synthesisone_settings AS source
CROSS JOIN (VALUES ('game_market_pricing:normal'), ('game_market_pricing:reseller')) AS target(key)
WHERE source.key = 'game_market_pricing:synthesisone'
ON CONFLICT (key) DO NOTHING;


-- Remove only legacy placeholder game rows created by the old seed if they never received
-- provider metadata and have no offers. Never remove a game with any offer attached.
DELETE FROM public.game_market_games AS game
USING public.game_market_stores AS store
WHERE game.store_id = store.id
  AND store.slug = 'synthesisone'
  AND game.slug IN ('free-fire', 'mobile-legends', 'honor-of-kings', 'genshin-impact')
  AND game.provider_game_slug IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.game_market_offers AS offer WHERE offer.game_id = game.id
  );
