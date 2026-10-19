-- SynthesisOne SO phase: profile sync, central Game Market catalog, separate reseller pricing,
-- private KYC storage, and reseller review.
-- Run in the SAME Supabase project referenced by Render's SUPABASE_URL.
-- Intentionally additive/idempotent: no existing SMS, webhook, payments, license, or support data is dropped.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Personal profile is separated from clients so changing appearance/privacy cannot overwrite
-- the existing client license/webhook/financial configuration.
CREATE TABLE IF NOT EXISTS public.synthesisone_profiles (
  client_id text PRIMARY KEY,
  display_name text,
  username text,
  avatar_path text,
  theme text NOT NULL DEFAULT 'violet',
  province text,
  municipality text,
  age smallint,
  display_name_public boolean NOT NULL DEFAULT false,
  avatar_public boolean NOT NULL DEFAULT false,
  age_public boolean NOT NULL DEFAULT false,
  location_public boolean NOT NULL DEFAULT false,
  local_data_imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'violet';
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS municipality text;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS age smallint;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS display_name_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS avatar_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS age_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS location_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS local_data_imported boolean NOT NULL DEFAULT false;
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.synthesisone_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='synthesisone_profiles_theme_check' AND conrelid='public.synthesisone_profiles'::regclass) THEN
    ALTER TABLE public.synthesisone_profiles ADD CONSTRAINT synthesisone_profiles_theme_check CHECK (theme IN ('violet','light','red','green','cyan')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='synthesisone_profiles_age_check' AND conrelid='public.synthesisone_profiles'::regclass) THEN
    ALTER TABLE public.synthesisone_profiles DROP CONSTRAINT synthesisone_profiles_age_check;
  END IF;
  ALTER TABLE public.synthesisone_profiles ADD CONSTRAINT synthesisone_profiles_age_check CHECK (age IS NULL OR age BETWEEN 1 AND 120) NOT VALID;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='synthesisone_profiles_username_check' AND conrelid='public.synthesisone_profiles'::regclass) THEN
    ALTER TABLE public.synthesisone_profiles ADD CONSTRAINT synthesisone_profiles_username_check CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$') NOT VALID;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS synthesisone_profiles_username_unique
  ON public.synthesisone_profiles (lower(username)) WHERE username IS NOT NULL;

-- Store table is created first so existing catalog rows from an earlier additive migration
-- can be attached to the official store without deleting them.
CREATE TABLE IF NOT EXISTS public.game_market_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_client_id text,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_platform_store boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.game_market_stores (name, slug, is_platform_store, is_active)
VALUES ('SynthesisOne SO', 'synthesisone', true, true)
ON CONFLICT (slug) DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS game_market_one_platform_store_idx
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
  CONSTRAINT game_market_game_store_slug_unique UNIQUE (store_id, slug),
  CONSTRAINT game_market_game_id_store_unique UNIQUE (id, store_id)
);
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Juegos';
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS thumbnail_path text;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS badge text;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.game_market_games ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.game_market_games g SET store_id=s.id
FROM public.game_market_stores s WHERE s.slug='synthesisone' AND g.store_id IS NULL;
ALTER TABLE public.game_market_games ALTER COLUMN store_id SET NOT NULL;
-- Older deployments used a globally unique slug. Replace that with store-scoped uniqueness
-- so a future independent store can use the same game slug without sharing catalog ownership.
ALTER TABLE public.game_market_games DROP CONSTRAINT IF EXISTS game_market_games_slug_key;
DROP INDEX IF EXISTS public.game_market_games_slug_unique;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_market_games_store_id_fkey' AND conrelid='public.game_market_games'::regclass) THEN
    ALTER TABLE public.game_market_games ADD CONSTRAINT game_market_games_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.game_market_stores(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_market_game_id_store_unique' AND conrelid='public.game_market_games'::regclass) THEN
    ALTER TABLE public.game_market_games ADD CONSTRAINT game_market_game_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_market_game_store_slug_unique' AND conrelid='public.game_market_games'::regclass) THEN
    ALTER TABLE public.game_market_games ADD CONSTRAINT game_market_game_store_slug_unique UNIQUE (store_id, slug);
  END IF;
END $$;
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
  price_reseller_cup numeric(18,2) CHECK (price_reseller_cup IS NULL OR price_reseller_cup >= 0),
  price_reseller_saldo numeric(18,2) CHECK (price_reseller_saldo IS NULL OR price_reseller_saldo >= 0),
  base_cost_usd numeric(12,4) CHECK (base_cost_usd IS NULL OR base_cost_usd >= 0),
  auto_pricing boolean NOT NULL DEFAULT false,
  available boolean NOT NULL DEFAULT true,
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS price_reseller_cup numeric(18,2);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS price_reseller_saldo numeric(18,2);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS price_normal_cup numeric(18,2);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS price_normal_saldo numeric(18,2);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS base_cost_usd numeric(12,4);
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS auto_pricing boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.game_market_offers ADD COLUMN IF NOT EXISTS package_data jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_market_offer_game_store_fk' AND conrelid='public.game_market_offers'::regclass) THEN
    ALTER TABLE public.game_market_offers ADD CONSTRAINT game_market_offer_game_store_fk
      FOREIGN KEY (game_id, store_id) REFERENCES public.game_market_games(id, store_id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS game_market_offers_game_listing_idx
  ON public.game_market_offers (store_id, game_id, published, available, sort_order);

-- Seed only the four games requested. Conflicts preserve existing metadata and user-created offers.
INSERT INTO public.game_market_games (store_id, slug, name, description, category, badge, sort_order)
SELECT s.id, v.slug, v.name, v.description, v.category, v.badge, v.sort_order
FROM public.game_market_stores s
CROSS JOIN (VALUES
  ('free-fire','Free Fire','Recargas y paquetes para Free Fire.','Battle Royale','POPULAR',10),
  ('mobile-legends','Mobile Legends','Diamantes y paquetes para Mobile Legends.','MOBA','MOBA',20),
  ('honor-of-kings','Honor of Kings','Tokens y paquetes para Honor of Kings.','MOBA','MOBA',30),
  ('genshin-impact','Genshin Impact','Cristales génesis y paquetes para Genshin Impact.','RPG','RPG',40)
) AS v(slug,name,description,category,badge,sort_order)
WHERE s.slug='synthesisone'
ON CONFLICT DO NOTHING;

-- Normal and reseller rates are independent. Sale orders/providers are intentionally not created in this phase.
INSERT INTO public.synthesisone_settings (key, value, updated_at)
VALUES
 ('game_market_pricing:normal', '{"usd_to_cup":1050,"usd_to_saldo":380,"profit_margin_pct":0,"cup_rounding_step":5,"saldo_rounding_step":1,"rounding_mode":"ceil"}'::jsonb, now()),
 ('game_market_pricing:reseller', '{"usd_to_cup":1050,"usd_to_saldo":380,"profit_margin_pct":0,"cup_rounding_step":5,"saldo_rounding_step":1,"rounding_mode":"ceil"}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.reseller_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  client_name text,
  client_phone text,
  card_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  phone_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  id_front_path text NOT NULL,
  id_back_path text NOT NULL,
  selfie_path text NOT NULL,
  accepted_terms boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending_review',
  review_note text,
  reviewed_by text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  activated_at timestamptz,
  deposit_min_cup numeric(18,2) NOT NULL DEFAULT 50000,
  deposit_confirmed boolean NOT NULL DEFAULT false,
  monthly_sales_count integer NOT NULL DEFAULT 0,
  monthly_sales_target integer NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS client_phone text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS card_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS phone_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS id_front_path text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS id_back_path text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS selfie_path text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS accepted_terms boolean NOT NULL DEFAULT false;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_review';
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS deposit_min_cup numeric(18,2) NOT NULL DEFAULT 50000;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS deposit_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS monthly_sales_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS monthly_sales_target integer NOT NULL DEFAULT 15;
ALTER TABLE public.reseller_applications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reseller_applications_status_check' AND conrelid='public.reseller_applications'::regclass) THEN
    ALTER TABLE public.reseller_applications DROP CONSTRAINT reseller_applications_status_check;
  END IF;
  ALTER TABLE public.reseller_applications ADD CONSTRAINT reseller_applications_status_check
    CHECK (status IN ('pending_review','changes_requested','approved_awaiting_deposit','active','rejected','suspended','expired')) NOT VALID;
END $$;
CREATE INDEX IF NOT EXISTS reseller_applications_status_date_idx ON public.reseller_applications (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS reseller_applications_client_date_idx ON public.reseller_applications (client_id, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reseller_one_open_application_per_client_idx
  ON public.reseller_applications (client_id)
  WHERE status IN ('pending_review','approved_awaiting_deposit','active');

CREATE TABLE IF NOT EXISTS public.reseller_profiles (
  client_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'approved_awaiting_deposit'
    CHECK (status IN ('approved_awaiting_deposit','active','rejected','suspended','expired')),
  deposit_confirmed boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  monthly_sales_count integer NOT NULL DEFAULT 0 CHECK (monthly_sales_count >= 0),
  last_sales_period date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Manual sales-count changes are auditable until an order/checkout system exists.
CREATE TABLE IF NOT EXISTS public.reseller_sales_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_client_id text NOT NULL,
  period_start date NOT NULL,
  previous_count integer NOT NULL CHECK (previous_count >= 0),
  new_count integer NOT NULL CHECK (new_count >= 0),
  reason text NOT NULL,
  admin_client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reseller_sales_adjustments_client_period_idx
  ON public.reseller_sales_adjustments (reseller_client_id, period_start DESC, created_at DESC);

-- One atomic, audited monthly sales adjustment. Called only through the server service key.
CREATE OR REPLACE FUNCTION public.so_set_reseller_monthly_sales(
  p_application_id uuid,
  p_new_count integer,
  p_reason text,
  p_admin_client_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_row public.reseller_applications%ROWTYPE;
  profile_row public.reseller_profiles%ROWTYPE;
  period_start date := date_trunc('month', timezone('utc', now()))::date;
  previous_count integer;
BEGIN
  IF p_new_count IS NULL OR p_new_count < 0 OR p_new_count > 100000 THEN
    RAISE EXCEPTION 'El total mensual debe ser un entero entre 0 y 100000';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'El motivo del ajuste manual es obligatorio';
  END IF;

  SELECT * INTO app_row FROM public.reseller_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud reseller no encontrada'; END IF;
  IF app_row.status <> 'active' THEN RAISE EXCEPTION 'Solo se pueden registrar ventas para una condición reseller activa'; END IF;

  SELECT * INTO profile_row FROM public.reseller_profiles WHERE client_id = app_row.client_id FOR UPDATE;
  IF NOT FOUND OR profile_row.status <> 'active' THEN RAISE EXCEPTION 'El perfil reseller no está activo'; END IF;
  previous_count := CASE WHEN profile_row.last_sales_period = period_start THEN profile_row.monthly_sales_count ELSE 0 END;

  INSERT INTO public.reseller_sales_adjustments (
    reseller_client_id, period_start, previous_count, new_count, reason, admin_client_id
  ) VALUES (
    app_row.client_id, period_start, previous_count, p_new_count, trim(p_reason), p_admin_client_id
  );

  UPDATE public.reseller_profiles SET monthly_sales_count = p_new_count, last_sales_period = period_start, updated_at = now()
    WHERE client_id = app_row.client_id;
  UPDATE public.reseller_applications SET monthly_sales_count = p_new_count, updated_at = now()
    WHERE id = app_row.id;

  RETURN jsonb_build_object(
    'ok', true, 'monthly_sales_count', p_new_count, 'monthly_sales_target', 15,
    'period_start', period_start, 'tracked_manually', true
  );
END;
$$;
REVOKE ALL ON FUNCTION public.so_set_reseller_monthly_sales(uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.so_set_reseller_monthly_sales(uuid, integer, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.so_set_reseller_monthly_sales(uuid, integer, text, text) TO service_role;

-- All new tables are accessed through the Node backend's server-only Supabase service key.
ALTER TABLE public.synthesisone_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_market_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_sales_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthesisone_settings ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['synthesisone_profiles','game_market_stores','game_market_games','game_market_offers','reseller_applications','reseller_profiles','reseller_sales_adjustments','synthesisone_settings'] LOOP
    p := 'so_backend_only_' || t;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=p) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', p, t);
    END IF;
  END LOOP;
END $$;

-- Private portrait/id-card files; only the service key may upload/delete them. Catalog images are public-read only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('so-profile-avatars','so-profile-avatars',false,2097152,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=2097152, allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('so-game-thumbnails','so-game-thumbnails',true,2097152,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=2097152, allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('so-reseller-kyc','so-reseller-kyc',false,2097152,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=2097152, allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SO game thumbnails public read') THEN
    EXECUTE 'CREATE POLICY "SO game thumbnails public read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = ''so-game-thumbnails'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SO private identity files backend only') THEN
    EXECUTE 'CREATE POLICY "SO private identity files backend only" ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> ''so-reseller-kyc'' AND bucket_id <> ''so-profile-avatars'') WITH CHECK (bucket_id <> ''so-reseller-kyc'' AND bucket_id <> ''so-profile-avatars'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SO thumbnails writes backend only') THEN
    EXECUTE 'CREATE POLICY "SO thumbnails writes backend only" ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> ''so-game-thumbnails'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SO thumbnails updates backend only') THEN
    EXECUTE 'CREATE POLICY "SO thumbnails updates backend only" ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (bucket_id <> ''so-game-thumbnails'') WITH CHECK (bucket_id <> ''so-game-thumbnails'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='SO thumbnails deletes backend only') THEN
    EXECUTE 'CREATE POLICY "SO thumbnails deletes backend only" ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (bucket_id <> ''so-game-thumbnails'')';
  END IF;
END $$;

COMMENT ON TABLE public.reseller_applications IS 'Private SO Reseller KYC, contacts, and manual review history; KYC files are private Storage objects.';
COMMENT ON TABLE public.reseller_profiles IS 'Reseller pricing entitlement independent of clients.role and the personal automation license.';
COMMENT ON TABLE public.reseller_sales_adjustments IS 'Auditable admin changes to manual monthly sales count until orders are implemented.';
COMMENT ON TABLE public.game_market_offers IS 'Official catalog offers with normal/reseller CUP and Saldo prices; wholesale USD is backend/admin-only.';
