-- Restore the originally declared research cadence. This job is shadow/research only.
-- Production had drifted from 41 */4 * * * to hourly 41 * * * *.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='cfi-forward-market-v2-research-4h';

  if v_jobid is null then
    raise exception 'CFI forward market research cron not found';
  end if;

  perform cron.alter_job(job_id := v_jobid, schedule := '41 */4 * * *');
end $$;
