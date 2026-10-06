CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.gha_dispatch_log (
  id bigserial PRIMARY KEY,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  http_status int,
  error text,
  token_expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS gha_dispatch_log_dispatched_idx ON public.gha_dispatch_log (dispatched_at DESC);
ALTER TABLE public.gha_dispatch_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gha_dispatch_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.gha_dispatch_log_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cfi_dispatch_gha_livescore(p_source text DEFAULT 'cron_primary')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_token text;
  v_resp extensions.http_response;
  v_expires_raw text;
  v_expires timestamptz;
  v_attempt int := 0;
BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'gha_pat' LIMIT 1;
  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO public.gha_dispatch_log (source, error) VALUES (p_source, 'PAT missing in Vault');
    RETURN;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    BEGIN
      PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
      SELECT * INTO v_resp FROM extensions.http((
        'POST',
        'https://api.github.com/repos/baoanhrat112020-boop/cfi-football-intelligence/actions/workflows/375412436/dispatches',
        ARRAY[
          extensions.http_header('Authorization', 'Bearer ' || v_token),
          extensions.http_header('Accept', 'application/vnd.github+json'),
          extensions.http_header('X-GitHub-Api-Version', '2022-11-28'),
          extensions.http_header('User-Agent', 'cfi-cron')
        ],
        'application/json',
        '{"ref":"main"}'
      )::extensions.http_request);

      SELECT (h).value INTO v_expires_raw
      FROM unnest(v_resp.headers) AS h
      WHERE lower((h).field) = 'github-authentication-token-expiration'
      LIMIT 1;
      BEGIN
        v_expires := NULLIF(v_expires_raw, '')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_expires := NULL;
      END;

      EXIT WHEN v_resp.status = 204 OR v_resp.status < 500 OR v_attempt >= 2;
    EXCEPTION WHEN OTHERS THEN
      IF v_attempt >= 2 THEN
        INSERT INTO public.gha_dispatch_log (source, error) VALUES (p_source, left(SQLERRM, 500));
        RETURN;
      END IF;
    END;
    PERFORM pg_sleep(2);
  END LOOP;

  INSERT INTO public.gha_dispatch_log (source, http_status, error, token_expires_at)
  VALUES (p_source, v_resp.status, CASE WHEN v_resp.status <> 204 THEN left(v_resp.content, 500) END, v_expires);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cfi_check_gha_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_token text;
  v_resp extensions.http_response;
  v_last_run timestamptz;
  v_last_dispatch record;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_last_dispatch FROM public.gha_dispatch_log WHERE source = 'cron_primary' ORDER BY dispatched_at DESC LIMIT 1;
  IF v_last_dispatch IS NULL OR v_last_dispatch.http_status IS DISTINCT FROM 204 THEN
    RAISE EXCEPTION 'GHA dispatch unhealthy: last cron_primary status=% error=% at=%', v_last_dispatch.http_status, v_last_dispatch.error, v_last_dispatch.dispatched_at;
  END IF;

  SELECT token_expires_at INTO v_expires FROM public.gha_dispatch_log WHERE token_expires_at IS NOT NULL ORDER BY dispatched_at DESC LIMIT 1;
  IF v_expires IS NOT NULL AND v_expires < now() + interval '14 days' THEN
    RAISE EXCEPTION 'GHA PAT expires soon: %', v_expires;
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'gha_pat' LIMIT 1;
  IF v_token IS NULL OR v_token = '' THEN
    RAISE EXCEPTION 'PAT missing in Vault';
  END IF;

  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
  SELECT * INTO v_resp FROM extensions.http((
    'GET',
    'https://api.github.com/repos/baoanhrat112020-boop/cfi-football-intelligence/actions/workflows/375412436/runs?per_page=1&status=success',
    ARRAY[
      extensions.http_header('Authorization', 'Bearer ' || v_token),
      extensions.http_header('Accept', 'application/vnd.github+json'),
      extensions.http_header('X-GitHub-Api-Version', '2022-11-28'),
      extensions.http_header('User-Agent', 'cfi-cron')
    ],
    NULL,
    NULL
  )::extensions.http_request);
  IF v_resp.status <> 200 THEN
    RAISE EXCEPTION 'GHA runs query failed: HTTP %', v_resp.status;
  END IF;

  v_last_run := ((v_resp.content::jsonb -> 'workflow_runs' -> 0) ->> 'created_at')::timestamptz;
  IF v_last_run IS NULL OR v_last_run < now() - interval '60 minutes' THEN
    RAISE EXCEPTION 'Livescore ingest stale: last successful GHA run at %', v_last_run;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cfi_dispatch_gha_livescore(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfi_check_gha_dispatch() FROM PUBLIC, anon, authenticated;
