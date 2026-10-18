-- SynthesisOne SO — operational incident centre and controlled store announcements.
-- Apply only after migrations 017 and 018 in the same Supabase project.

CREATE TABLE IF NOT EXISTS public.service_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  component text NOT NULL,
  severity text NOT NULL DEFAULT 'WARN' CHECK (severity IN ('INFO','WARN','ERROR','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_incidents_status_last_seen_idx
  ON public.service_incidents (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS service_incidents_component_status_idx
  ON public.service_incidents (component, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.store_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 1500),
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','PROMO','WARN')),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_announcements_dates_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS store_announcements_active_idx
  ON public.store_announcements (enabled, starts_at, ends_at);

ALTER TABLE public.service_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_incidents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.store_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_incidents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_announcements TO service_role;

CREATE OR REPLACE FUNCTION public.record_service_incident(
  p_fingerprint text,
  p_component text,
  p_severity text,
  p_title text,
  p_message text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_previous_status text;
  v_incident public.service_incidents%ROWTYPE;
  v_should_notify boolean;
BEGIN
  IF COALESCE(length(trim(p_fingerprint)), 0) < 3 OR length(p_fingerprint) > 180 THEN
    RAISE EXCEPTION 'INVALID_INCIDENT_FINGERPRINT' USING ERRCODE = '22023';
  END IF;
  IF p_severity NOT IN ('INFO','WARN','ERROR','CRITICAL') THEN
    RAISE EXCEPTION 'INVALID_INCIDENT_SEVERITY' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_previous_status FROM public.service_incidents WHERE fingerprint = p_fingerprint;
  v_should_notify := NOT FOUND OR v_previous_status = 'RESOLVED';

  INSERT INTO public.service_incidents (
    fingerprint, component, severity, status, title, message, metadata,
    occurrence_count, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    p_fingerprint, left(p_component, 80), p_severity, 'OPEN', left(p_title, 180), left(p_message, 2000),
    COALESCE(p_metadata, '{}'::jsonb), 1, now(), now(), now()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    component = EXCLUDED.component,
    severity = EXCLUDED.severity,
    status = 'OPEN',
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    metadata = EXCLUDED.metadata,
    occurrence_count = public.service_incidents.occurrence_count + 1,
    last_seen_at = now(),
    acknowledged_at = CASE WHEN public.service_incidents.status = 'RESOLVED' THEN NULL ELSE public.service_incidents.acknowledged_at END,
    acknowledged_by = CASE WHEN public.service_incidents.status = 'RESOLVED' THEN NULL ELSE public.service_incidents.acknowledged_by END,
    resolved_at = NULL,
    resolved_by = NULL,
    resolution_note = NULL,
    updated_at = now()
  RETURNING * INTO v_incident;

  RETURN jsonb_build_object('incident', to_jsonb(v_incident), 'notify_admins', v_should_notify);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_service_incident(
  p_id uuid,
  p_resolved_by text DEFAULT 'admin',
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_incident public.service_incidents%ROWTYPE;
BEGIN
  UPDATE public.service_incidents SET
    status = 'RESOLVED', resolved_at = now(), resolved_by = left(COALESCE(p_resolved_by, 'admin'), 120),
    resolution_note = left(NULLIF(trim(p_note), ''), 1000), updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_incident;
  IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(v_incident);
END;
$$;

REVOKE ALL ON FUNCTION public.record_service_incident(text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_service_incident(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_incident(text,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_service_incident(uuid,text,text) TO service_role;

COMMENT ON TABLE public.service_incidents IS 'Incidencias operativas deduplicadas de pagos, Wallet, proveedores y conectividad; acceso exclusivo de backend/administración.';
COMMENT ON TABLE public.store_announcements IS 'Avisos/promociones publicados por administración para los usuarios de la tienda oficial.';
