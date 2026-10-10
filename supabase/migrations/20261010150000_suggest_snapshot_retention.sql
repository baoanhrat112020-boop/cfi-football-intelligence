SELECT cron.schedule(
  'suggest-snapshot-retention',
  '0 4 * * *',
  $$DELETE FROM public.suggest_snapshot WHERE snapshot_date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 30$$
);
