-- SynthesisOne AI Assistant: per-client and global daily quotas.
-- Run once in the same Supabase project used by the production backend.
-- Only request counters are stored; chat content is never persisted.

CREATE TABLE IF NOT EXISTS public.ai_assistant_usage (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  usage_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, usage_day)
);

CREATE TABLE IF NOT EXISTS public.ai_assistant_global_usage (
  usage_day date PRIMARY KEY DEFAULT (now() AT TIME ZONE 'UTC')::date,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_assistant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_global_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_assistant_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_assistant_global_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_assistant_usage TO service_role;
GRANT ALL ON TABLE public.ai_assistant_global_usage TO service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_assistant_request(
  p_client_id uuid,
  p_daily_limit integer,
  p_global_daily_limit integer
)
RETURNS TABLE(allowed boolean, used integer, global_used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_used integer := 0;
  v_global_used integer := 0;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_daily_limit, 25), 200));
  v_global_limit integer := GREATEST(1, LEAST(COALESCE(p_global_daily_limit, 40), 10000));
  v_day date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Used by the authenticated config endpoint to check migration readiness
  -- without consuming either quota.
  IF p_client_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 0;
    RETURN;
  END IF;

  -- Serialize quota reservations for the current day so simultaneous requests
  -- cannot exceed either the per-client limit or the application-wide limit.
  PERFORM pg_advisory_xact_lock(hashtext('ai_assistant_usage:' || v_day::text));

  SELECT client_usage.request_count INTO v_client_used
  FROM public.ai_assistant_usage AS client_usage
  WHERE client_usage.client_id = p_client_id AND client_usage.usage_day = v_day
  FOR UPDATE;
  v_client_used := COALESCE(v_client_used, 0);

  IF v_client_used >= v_limit THEN
    SELECT global_usage.request_count INTO v_global_used
    FROM public.ai_assistant_global_usage AS global_usage
    WHERE global_usage.usage_day = v_day;
    RETURN QUERY SELECT false, v_client_used, COALESCE(v_global_used, 0);
    RETURN;
  END IF;

  INSERT INTO public.ai_assistant_global_usage (usage_day, request_count, updated_at)
  VALUES (v_day, 0, now())
  ON CONFLICT (usage_day) DO NOTHING;

  SELECT global_usage.request_count INTO v_global_used
  FROM public.ai_assistant_global_usage AS global_usage
  WHERE global_usage.usage_day = v_day
  FOR UPDATE;
  v_global_used := COALESCE(v_global_used, 0);

  IF v_global_used >= v_global_limit THEN
    RETURN QUERY SELECT false, v_client_used, v_global_used;
    RETURN;
  END IF;

  INSERT INTO public.ai_assistant_usage AS current_client_usage (client_id, usage_day, request_count, updated_at)
  VALUES (p_client_id, v_day, 1, now())
  ON CONFLICT (client_id, usage_day) DO UPDATE
    SET request_count = current_client_usage.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_client_used;

  INSERT INTO public.ai_assistant_global_usage AS current_global_usage (usage_day, request_count, updated_at)
  VALUES (v_day, 1, now())
  ON CONFLICT (usage_day) DO UPDATE
    SET request_count = current_global_usage.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_global_used;

  RETURN QUERY SELECT true, v_client_used, v_global_used;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_assistant_request(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_assistant_request(uuid, integer, integer) TO service_role;

COMMENT ON TABLE public.ai_assistant_usage IS 'Daily AI Assistant request counts per client only. Conversation prompts and responses are not stored.';
COMMENT ON TABLE public.ai_assistant_global_usage IS 'Daily global AI Assistant request counts only. Conversation prompts and responses are not stored.';
