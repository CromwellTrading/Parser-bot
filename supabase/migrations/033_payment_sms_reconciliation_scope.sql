-- SynthesisOne 033: narrow payment SMS reconciliation to clients with eligible payment tickets.
-- This avoids repeatedly returning other clients' SMS rows to the backend.
CREATE OR REPLACE FUNCTION public.list_payment_reconciliation_sms(
  p_client_ids uuid[],
  p_received_after timestamptz,
  p_limit integer DEFAULT 10000
)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'id', s.id,
    'client_id', s.client_id,
    'sender', s.sender,
    'body', s.body,
    'received_at', s.received_at
  )
  FROM public.sms_logs AS s
  WHERE s.client_id = ANY(COALESCE(p_client_ids, ARRAY[]::uuid[]))
    AND s.received_at >= COALESCE(p_received_after, now() - interval '72 hours')
  ORDER BY s.received_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10000), 1), 20000);
$function$;

REVOKE ALL ON FUNCTION public.list_payment_reconciliation_sms(uuid[], timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_payment_reconciliation_sms(uuid[], timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.list_payment_reconciliation_sms(uuid[], timestamptz, integer)
  IS 'Returns only recent SMS needed to reconcile eligible official-store payment tickets; restricted to backend service_role.';
