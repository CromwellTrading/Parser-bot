-- SynthesisOne production security hardening (additive, idempotent).
-- All application data access must go through the authenticated backend, which
-- uses the Supabase service_role key. Never embed that key in the Android APK.
-- This migration protects every application relation/function in public, including
-- tables created by later migrations. Storage policies/buckets are intentionally
-- untouched so public game thumbnails and private KYC storage keep their own rules.

BEGIN;

DO $$
DECLARE
  v_role text;
  v_relation record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'SynthesisOne RLS migration requires the Supabase service_role';
  END IF;

  -- Tables and partitioned tables: RLS is enabled and forced. There are no client
  -- policies because clients never access application tables directly; backend
  -- service_role access is retained explicitly.
  FOR v_relation IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    IF v_relation.relkind IN ('r', 'p') THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_relation.relname);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_relation.relname);
    END IF;

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', v_relation.relname);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', v_relation.relname);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', v_relation.relname);
    END IF;
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', v_relation.relname);
  END LOOP;

  -- Sequence access is required for server-side inserts that use serial/identity
  -- columns. Client roles receive no sequence privileges.
  FOR v_relation IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC', v_relation.relname);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM anon', v_relation.relname);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM authenticated', v_relation.relname);
    END IF;
    EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE public.%I TO service_role', v_relation.relname);
  END LOOP;

  -- PostgREST RPCs are also backend-only. Trigger calls remain internal to Postgres;
  -- service_role keeps EXECUTE on every application function/aggregate in public.
  FOR v_relation IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'w', 'a')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.%I(%s) FROM PUBLIC', v_relation.proname, v_relation.identity_args);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.%I(%s) FROM anon', v_relation.proname, v_relation.identity_args);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.%I(%s) FROM authenticated', v_relation.proname, v_relation.identity_args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_relation.proname, v_relation.identity_args);
  END LOOP;

  -- Procedures have a distinct GRANT target type in PostgreSQL.
  FOR v_relation IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'p'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON PROCEDURE public.%I(%s) FROM PUBLIC', v_relation.proname, v_relation.identity_args);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON PROCEDURE public.%I(%s) FROM anon', v_relation.proname, v_relation.identity_args);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON PROCEDURE public.%I(%s) FROM authenticated', v_relation.proname, v_relation.identity_args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON PROCEDURE public.%I(%s) TO service_role', v_relation.proname, v_relation.identity_args);
  END LOOP;

  -- Prevent accidental exposure when future migrations create new public objects.
  -- These defaults apply to objects created by the role executing this migration.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    current_user
  );

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon', current_user);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated', current_user);
  END IF;

  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON TABLES TO service_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role', current_user);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role', current_user);
END $$;

-- Keep the public schema non-creatable by API client roles. USAGE is retained for
-- compatibility with PostgREST discovery; object privileges and RLS remain closed.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE CREATE ON SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE CREATE ON SCHEMA public FROM authenticated;
  END IF;
END $$;

COMMIT;
