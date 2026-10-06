SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('livescore-dispatch-gha', 'livescore-freshness-check');

SELECT cron.schedule('livescore-dispatch-gha', '5,35 * * * *', $cron$SELECT public.cfi_dispatch_gha_livescore('cron_primary');$cron$);
SELECT cron.schedule('livescore-freshness-check', '12,42 * * * *', $cron$SELECT public.cfi_check_gha_dispatch();$cron$);
