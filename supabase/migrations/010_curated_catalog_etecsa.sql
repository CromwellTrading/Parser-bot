-- SynthesisOne phase 3: restore the curated public catalog and ensure ETECSA is discoverable.
-- Existing catalogue rows/offers are preserved; unrelated legacy rows are hidden, not deleted.
-- Run after 009_profiles_game_market_reseller_offline.sql in the same Supabase project.

DO $$
DECLARE
  v_store_id uuid;
  v_etecsa_id uuid;
BEGIN
  SELECT id INTO v_store_id
  FROM public.game_market_stores
  WHERE slug = 'synthesisone'
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'La tienda oficial no existe. Ejecuta primero la migración 009.';
  END IF;

  -- Prefer an existing ETECSA parent item so existing offers linked to it remain intact.
  SELECT id INTO v_etecsa_id
  FROM public.game_market_games
  WHERE store_id = v_store_id
    AND (
      lower(slug) IN ('etecsa', 'etecsa-recargas')
      OR lower(name) = 'etecsa'
      OR lower(name) LIKE 'etecsa %'
      OR lower(slug) LIKE 'etecsa%'
    )
  ORDER BY
    CASE
      WHEN lower(slug) = 'etecsa' THEN 0
      WHEN lower(name) = 'etecsa' THEN 1
      WHEN lower(slug) = 'etecsa-recargas' THEN 2
      ELSE 3
    END,
    sort_order,
    created_at
  LIMIT 1;

  IF v_etecsa_id IS NULL THEN
    INSERT INTO public.game_market_games (
      store_id, slug, name, description, category, badge, is_active, sort_order, created_at, updated_at
    ) VALUES (
      v_store_id,
      'etecsa-recargas',
      'ETECSA',
      'Recargas y paquetes ETECSA configurados por SynthesisOne.',
      'Telecomunicaciones',
      'ETECSA',
      true,
      5,
      now(),
      now()
    )
    ON CONFLICT (store_id, slug) DO UPDATE SET
      is_active = true,
      updated_at = now()
    RETURNING id INTO v_etecsa_id;
  ELSE
    UPDATE public.game_market_games
    SET name = CASE
          WHEN lower(name) LIKE '%etecsa%' THEN name
          ELSE 'ETECSA'
        END,
        description = COALESCE(NULLIF(btrim(description), ''), 'Recargas y paquetes ETECSA configurados por SynthesisOne.'),
        category = CASE
          WHEN category IS NULL OR btrim(category) = '' OR lower(category) IN ('juegos', 'otros') THEN 'Telecomunicaciones'
          ELSE category
        END,
        badge = COALESCE(NULLIF(btrim(badge), ''), 'ETECSA'),
        is_active = true,
        sort_order = 5,
        updated_at = now()
    WHERE id = v_etecsa_id;
  END IF;

  -- The intended initial catalog is the four first games plus the ETECSA service.
  -- Older imported entries remain in the admin catalog, searchable and reactivatable.
  UPDATE public.game_market_games
  SET is_active = false,
      updated_at = now()
  WHERE store_id = v_store_id
    AND slug NOT IN ('free-fire', 'mobile-legends', 'honor-of-kings', 'genshin-impact')
    AND id <> v_etecsa_id
    AND lower(slug) NOT LIKE 'etecsa%'
    AND lower(name) NOT LIKE '%etecsa%';

  -- Preserve any existing ETECSA-labelled entries so offers already attached to them
  -- remain discoverable; the main ETECSA parent is always enabled as well.
  UPDATE public.game_market_games
  SET is_active = true,
      updated_at = now()
  WHERE store_id = v_store_id
    AND (id = v_etecsa_id OR lower(slug) LIKE 'etecsa%' OR lower(name) LIKE '%etecsa%');

  UPDATE public.game_market_games
  SET is_active = true,
      sort_order = CASE slug
        WHEN 'free-fire' THEN 10
        WHEN 'mobile-legends' THEN 20
        WHEN 'honor-of-kings' THEN 30
        WHEN 'genshin-impact' THEN 40
        ELSE sort_order
      END,
      updated_at = now()
  WHERE store_id = v_store_id
    AND slug IN ('free-fire', 'mobile-legends', 'honor-of-kings', 'genshin-impact');
END $$;

COMMENT ON TABLE public.game_market_games IS
  'SynthesisOne curated catalogue. Unlisted legacy entries are retained with is_active=false and can be re-enabled by an administrator.';
