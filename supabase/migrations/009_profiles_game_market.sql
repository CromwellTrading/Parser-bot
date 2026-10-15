-- SynthesisOne: profiles, official Game Market catalog, server-side prices and Storage.
-- Run in the Supabase project already used by the deployed Parser-bot backend.
-- This migration is additive. It does not drop or rewrite existing licensing/SMS tables.

-- Match the existing public.clients.id type exactly because the supplied project does
-- not include the original CREATE TABLE migration for clients.
DO $$
DECLARE
  client_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO client_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clients'::regclass
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF client_id_type IS NULL THEN
    RAISE EXCEPTION 'No se encontró public.clients.id; revisa el esquema de Supabase antes de ejecutar esta migración';
  END IF;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS public.synthesisone_profiles (
      client_id %s PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
      display_name text,
      username text,
      avatar_path text,
      theme text NOT NULL DEFAULT 'violet' CHECK (theme IN ('violet','light','red','green','cyan')),
      province text,
      municipality text,
      age smallint CHECK (age IS NULL OR age BETWEEN 1 AND 120),
      local_data_imported boolean NOT NULL DEFAULT false,
      display_name_public boolean NOT NULL DEFAULT false,
      avatar_public boolean NOT NULL DEFAULT false,
      age_public boolean NOT NULL DEFAULT false,
      location_public boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT synthesisone_profiles_username_chk
        CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$')
    )
  $sql$, client_id_type);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS public.game_market_stores (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_client_id %s REFERENCES public.clients(id) ON DELETE SET NULL,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      is_platform_store boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, client_id_type);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS synthesisone_profiles_username_unique
  ON public.synthesisone_profiles (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS synthesisone_profiles_updated_idx
  ON public.synthesisone_profiles (updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS game_market_single_platform_store_idx
  ON public.game_market_stores (is_platform_store) WHERE is_platform_store = true;

CREATE TABLE IF NOT EXISTS public.game_market_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.game_market_stores(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description text,
  category text NOT NULL DEFAULT 'Juegos',
  thumbnail_path text,
  badge text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_market_games_store_slug_unique UNIQUE (store_id, slug),
  CONSTRAINT game_market_games_id_store_unique UNIQUE (id, store_id)
);
CREATE INDEX IF NOT EXISTS game_market_games_listing_idx
  ON public.game_market_games (store_id, is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.game_market_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.game_market_stores(id) ON DELETE CASCADE,
  game_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text,
  category text NOT NULL DEFAULT 'Paquete',
  package_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_cup numeric(18,2) NOT NULL DEFAULT 0 CHECK (price_cup >= 0),
  price_saldo numeric(18,2) NOT NULL DEFAULT 0 CHECK (price_saldo >= 0),
  -- Internal wholesale cost. API omits it for non-admin users.
  base_cost_usd numeric(12,4) CHECK (base_cost_usd IS NULL OR base_cost_usd >= 0),
  auto_pricing boolean NOT NULL DEFAULT false,
  available boolean NOT NULL DEFAULT true,
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_market_offers_game_store_fk
    FOREIGN KEY (game_id, store_id)
    REFERENCES public.game_market_games (id, store_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_market_offers_game_listing_idx
  ON public.game_market_offers (game_id, published, available, sort_order);
CREATE INDEX IF NOT EXISTS game_market_offers_store_idx
  ON public.game_market_offers (store_id, game_id);

-- Reuse the project's existing settings table with a per-store key so later shops keep independent rates.
INSERT INTO public.synthesisone_settings (key, value, updated_at)
VALUES (
  'game_market_pricing:synthesisone',
  '{"usd_to_cup":1050,"usd_to_saldo":380,"profit_margin_pct":0,"cup_rounding_step":5,"saldo_rounding_step":1,"rounding_mode":"ceil"}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.game_market_stores (name, slug, is_platform_store, is_active)
VALUES ('SynthesisOne', 'synthesisone', true, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.game_market_games (store_id, slug, name, description, category, badge, sort_order)
SELECT store_row.id, seed.slug, seed.name, seed.description, seed.category, seed.badge, seed.sort_order
FROM public.game_market_stores AS store_row
CROSS JOIN (VALUES
  ('free-fire', 'Free Fire', 'Recargas y paquetes para Free Fire.', 'Battle Royale', 'POPULAR', 10),
  ('mobile-legends', 'Mobile Legends', 'Diamantes y paquetes para Mobile Legends.', 'MOBA', 'MOBA', 20),
  ('honor-of-kings', 'Honor of Kings', 'Tokens y paquetes para Honor of Kings.', 'MOBA', 'MOBA', 30),
  ('genshin-impact', 'Genshin Impact', 'Cristales génesis y paquetes para Genshin Impact.', 'RPG', 'RPG', 40)
) AS seed(slug, name, description, category, badge, sort_order)
WHERE store_row.slug = 'synthesisone'
ON CONFLICT (store_id, slug) DO NOTHING;

-- Tables are accessed through the Node.js backend using SUPABASE_SERVICE_KEY.
-- Restrictive policies below explicitly prevent direct anon/authenticated table access.
ALTER TABLE public.synthesisone_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthesisone_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_offers ENABLE ROW LEVEL SECURITY;

-- Explicit restrictive policies block anon/authenticated direct access even if a broad
-- permissive policy was added to one of these tables in the project previously.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'synthesisone_profiles', 'synthesisone_settings', 'game_market_stores',
    'game_market_games', 'game_market_offers'
  ] LOOP
    policy_name := 'synthesisone_backend_only_' || table_name;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        policy_name, table_name
      );
    END IF;
  END LOOP;
END $$;

-- Storage: profile pictures are private and only served through short-lived signed URLs.
-- Game thumbnails are public-readable; uploads/deletes happen with the backend service key.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('so-profile-avatars', 'so-profile-avatars', false, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('so-game-thumbnails', 'so-game-thumbnails', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'SynthesisOne game thumbnails are publicly readable'
  ) THEN
    EXECUTE 'CREATE POLICY "SynthesisOne game thumbnails are publicly readable" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = ''so-game-thumbnails'')';
  END IF;

  -- Do not allow client keys to read private avatars through the Storage API, nor upload,
  -- overwrite or delete either bucket. The server service key is the only writer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'SynthesisOne avatars are backend-only'
  ) THEN
    EXECUTE 'CREATE POLICY "SynthesisOne avatars are backend-only" ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> ''so-profile-avatars'') WITH CHECK (bucket_id <> ''so-profile-avatars'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'SynthesisOne thumbnails insert backend-only'
  ) THEN
    EXECUTE 'CREATE POLICY "SynthesisOne thumbnails insert backend-only" ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> ''so-game-thumbnails'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'SynthesisOne thumbnails update backend-only'
  ) THEN
    EXECUTE 'CREATE POLICY "SynthesisOne thumbnails update backend-only" ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (bucket_id <> ''so-game-thumbnails'') WITH CHECK (bucket_id <> ''so-game-thumbnails'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'SynthesisOne thumbnails delete backend-only'
  ) THEN
    EXECUTE 'CREATE POLICY "SynthesisOne thumbnails delete backend-only" ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (bucket_id <> ''so-game-thumbnails'')';
  END IF;
END $$;

COMMENT ON TABLE public.synthesisone_profiles IS 'SynthesisOne personal profile data linked to the existing clients identity; private by default.';
COMMENT ON TABLE public.game_market_stores IS 'Store identity table reserved for future independent seller stores; current API manages only the platform store.';
COMMENT ON TABLE public.game_market_games IS 'Games offered by a specific store; store_id isolates the official catalog from future seller catalogs.';
COMMENT ON TABLE public.game_market_offers IS 'Offers per game/store, with public CUP/Saldo prices and admin-only wholesale USD fields.';
