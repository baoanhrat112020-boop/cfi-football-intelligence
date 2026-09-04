create or replace function public.cfi_capture_daily_prediction_audit(
  p_target_date date default ((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1)
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_selected integer;
  v_settled integer;
  v_terminal integer;
  v_eligible integer;
  v_pending integer;
  v_coverage numeric;
  v_status text;
  v_metrics jsonb;
  v_run uuid;
begin
  select
    count(*) filter (where e.selected_for_match_audit),
    count(*) filter (where e.selected_for_match_audit and e.settlement_status='SETTLED'),
    count(*) filter (where e.selected_for_match_audit and t.snapshot_id is not null),
    count(*) filter (where e.selected_for_match_audit and e.settlement_status='PENDING' and t.snapshot_id is null)
  into v_selected,v_settled,v_terminal,v_pending
  from public.cfi_prediction_evaluation e
  left join public.cfi_prediction_terminal_resolutions t on t.snapshot_id=e.snapshot_id
  where e.target_date=p_target_date;

  v_selected := coalesce(v_selected,0);
  v_settled := coalesce(v_settled,0);
  v_terminal := coalesce(v_terminal,0);
  v_pending := coalesce(v_pending,0);
  v_eligible := greatest(v_selected-v_terminal,0);
  v_coverage := case when v_eligible=0 then 1 else v_settled::numeric/v_eligible end;
  v_status := case
    when v_selected=0 then 'NO_PREDICTIONS'
    when v_pending=0 and v_settled=v_eligible then 'COMPLETE'
    when v_settled=0 and v_eligible>0 then 'BLOCKED'
    else 'PARTIAL'
  end;

  with settled as (
    select e.*,
      case e.rank_1_market
        when '3+ HT' then e.outcome_3plus_ht
        when '7+ FT' then e.outcome_7plus_ft
        when 'Other HT' then e.outcome_other_ht
        when 'Other FT' then e.outcome_other_ft
        else null
      end as rank1_outcome
    from public.cfi_prediction_evaluation e
    where e.target_date=p_target_date
      and e.selected_for_match_audit=true
      and e.settlement_status='SETTLED'
  )
  select jsonb_build_object(
    'rawSelected',v_selected,
    'effectiveEligible',v_eligible,
    'terminalExcluded',v_terminal,
    'activePending',v_pending,
    'marketActuals', jsonb_build_object(
      '3+ HT', jsonb_build_object('occurred',count(*) filter(where outcome_3plus_ht='HIT'),'notOccurred',count(*) filter(where outcome_3plus_ht='MISS')),
      '7+ FT', jsonb_build_object('occurred',count(*) filter(where outcome_7plus_ft='HIT'),'notOccurred',count(*) filter(where outcome_7plus_ft='MISS')),
      'Other HT', jsonb_build_object('occurred',count(*) filter(where outcome_other_ht='HIT'),'notOccurred',count(*) filter(where outcome_other_ht='MISS')),
      'Other FT', jsonb_build_object('occurred',count(*) filter(where outcome_other_ft='HIT'),'notOccurred',count(*) filter(where outcome_other_ft='MISS'))
    ),
    'rank1Prediction', jsonb_build_object(
      'eligible',count(*) filter(where rank1_outcome is not null),
      'hit',count(*) filter(where rank1_outcome='HIT'),
      'miss',count(*) filter(where rank1_outcome='MISS'),
      'hitRate',case when count(*) filter(where rank1_outcome is not null)>0 then
        (count(*) filter(where rank1_outcome='HIT'))::numeric / (count(*) filter(where rank1_outcome is not null)) else null end
    ),
    'strongSignalRank1', jsonb_build_object(
      'eligible',count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome is not null),
      'hit',count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome='HIT'),
      'miss',count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome='MISS'),
      'hitRate',case when count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome is not null)>0 then
        (count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome='HIT'))::numeric /
        (count(*) filter(where verdict='STRONG_SIGNAL' and rank1_outcome is not null)) else null end
    ),
    'meanBrier', avg(mean_brier),
    'top1HT', jsonb_build_object('hit',count(*) filter(where top1_ht_hit is true),'miss',count(*) filter(where top1_ht_hit is false)),
    'top1FT', jsonb_build_object('hit',count(*) filter(where top1_ft_hit is true),'miss',count(*) filter(where top1_ft_hit is false)),
    'top3HT', jsonb_build_object('hit',count(*) filter(where top3_ht_hit is true),'miss',count(*) filter(where top3_ht_hit is false)),
    'top3FT', jsonb_build_object('hit',count(*) filter(where top3_ft_hit is true),'miss',count(*) filter(where top3_ft_hit is false)),
    'strongSignals', count(*) filter(where verdict='STRONG_SIGNAL'),
    'settledRows', count(*)
  ) into v_metrics
  from settled;

  insert into public.cfi_daily_prediction_audit_runs(target_date,selected_count,settled_count,pending_count,coverage,status,metrics)
  values(p_target_date,v_selected,v_settled,v_pending,v_coverage,v_status,coalesce(v_metrics,'{}'::jsonb))
  returning run_id into v_run;

  return jsonb_build_object(
    'status','OK','runId',v_run,'targetDate',p_target_date,
    'selected',v_selected,'eligible',v_eligible,'settled',v_settled,
    'terminalExcluded',v_terminal,'pending',v_pending,'coverage',v_coverage,
    'auditStatus',v_status,'metrics',v_metrics
  );
end;
$function$;

revoke execute on function public.cfi_capture_daily_prediction_audit(date) from public, anon, authenticated;
grant execute on function public.cfi_capture_daily_prediction_audit(date) to service_role;
