-- Keep the existing settlement cadence and multimarket evaluator, but route prediction
-- settlement through the selected canonical dispatcher so raw replay snapshots cannot starve the queue.
do $$
declare
  v_jobid bigint;
  v_old text;
  v_new text;
begin
  select jobid, command into v_jobid, v_old
  from cron.job
  where jobname='cfi-prediction-settlement-hourly';

  if v_jobid is null or v_old is null then
    raise exception 'CFI settlement cron not found';
  end if;

  v_new := replace(v_old, '/functions/v1/cfi-result-collector''', '/functions/v1/cfi-result-collector-selected''');
  v_new := replace(v_new, 'body := ''{"concurrency":3}''::jsonb', 'body := ''{"limit":6,"maxAgeDays":4}''::jsonb');

  if v_new = v_old then
    raise exception 'CFI settlement cron patch made no change';
  end if;

  perform cron.alter_job(job_id := v_jobid, command := v_new);
end $$;
