-- SynthesisOne security hardening.
-- All application database access is performed by the backend with the service_role.
-- Client APKs must never connect directly to Postgres/Supabase tables.
-- Keep public storage buckets (e.g. catalog thumbnails) separate from these private records.
DO $$
DECLARE
  table_name text;
  protected_tables text[] := ARRAY[
    'clients', 'sms_logs', 'activation_codes', 'license_events', 'revoked_tokens',
    'license_activation_sessions', 'license_payments', 'token_blacklist',
    'webhook_deliveries', 'webhook_event_logs', 'support_messages',
    'reseller_applications', 'reseller_profiles', 'reseller_sales_adjustments', 'synthesisone_profiles',
    'game_market_stores', 'game_market_games', 'game_market_offers', 'game_market_favorites',
    'game_recharge_orders', 'etecsa_orders', 'etecsa_webhook_events', 'rechargegames_webhook_events',
    'store_wallets', 'store_wallet_topups', 'store_wallet_transactions',
    'store_payment_transaction_claims', 'service_incidents', 'store_announcements',
    'synthesisone_settings', 'rechargegames_catalog_state', 'store_sessions',
    'store_session_events', 'kyc_documents', 'client_devices'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Function EXECUTE grants are intentionally not changed globally here: each RPC has its own
-- signature-specific grants in its owning migration. A blanket revoke can break backend RPCs.
-- Audit and revoke only RPCs whose SQL grants explicitly show client-side exposure.
