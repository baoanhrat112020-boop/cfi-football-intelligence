select cron.schedule(
  'cfi-agent-social-publisher-4h',
  '19 */4 * * *',
  $$
  select net.http_post(
    url := 'https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-agent-social-publisher',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cfi-scheduler-token',(select token from public.cfi_scheduler_tokens where token_name='agent_social_publisher')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);