SELECT cron.schedule(
  'cfi-collector-runs-retention',
  '17 3 * * *',
  $$DELETE FROM public.cfi_result_collector_runs WHERE created_at < now() - interval '14 days'$$
);
