-- CFI Fusion V3 automatic research evaluation.
-- Does NOT promote or mutate production decision authority.

create or replace function public.cfi_mm_fusion_v3_auto_evaluate()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  t record;
  ev jsonb;
  checked integer:=0;
  refreshed integer:=0;
  ready integer:=0;
begin
  for t in
    select trial_id,status,min_settled_samples
    from public.cfi_mm_fusion_v3_prospective_trials
    where status in ('COLLECTING','READY_FOR_EVALUATION')
    order by created_at
  loop
    checked:=checked+1;
    ev:=public.cfi_mm_fusion_v3_trial_evaluation(t.trial_id);

    update public.cfi_mm_fusion_v3_prospective_trials
    set result=ev,
        updated_at=now(),
        status=case
          when coalesce((ev->>'n')::integer,0)>=min_settled_samples
               and ev->>'status'='READY_FOR_PROMOTION_GATE'
            then 'READY_FOR_EVALUATION'
          else status
        end
    where trial_id=t.trial_id;

    refreshed:=refreshed+1;
    if coalesce((ev->>'n')::integer,0)>=t.min_settled_samples
       and ev->>'status'='READY_FOR_PROMOTION_GATE'
    then ready:=ready+1;
    end if;
  end loop;

  return jsonb_build_object(
    'version','CFI_MULTI_MARKET_FUSION_V3_AUTO_EVALUATE_V1',
    'checked',checked,
    'refreshed',refreshed,
    'readyForPromotionGate',ready,
    'decisionUse',false,
    'productionPromotion',false,
    'automaticPromotion',false,
    'policy','AUTO_EVALUATE_ONLY_EXPLICIT_PROMOTION_REQUIRED'
  );
end
$$;

revoke all on function public.cfi_mm_fusion_v3_auto_evaluate() from public,anon,authenticated;
grant execute on function public.cfi_mm_fusion_v3_auto_evaluate() to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='cfi-mm-fusion-v3-auto-evaluate-hourly'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'cfi-mm-fusion-v3-auto-evaluate-hourly',
    '47 * * * *',
    'select public.cfi_mm_fusion_v3_auto_evaluate();'
  );
end
$$;

comment on function public.cfi_mm_fusion_v3_auto_evaluate() is
'Hourly research-only Fusion V3 trial evaluator. Refreshes metrics/result and READY_FOR_EVALUATION status only. Never promotes production or enables decisionUse.';
