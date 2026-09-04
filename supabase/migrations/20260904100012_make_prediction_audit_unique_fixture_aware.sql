-- Daily settlement audit counts canonical fixtures, not duplicate snapshot aliases.
-- Immutable snapshot lineage remains untouched.

create or replace function public.cfi_capture_daily_prediction_audit(
  p_target_date date default ((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1)
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_raw_selected integer;
  v_unique_selected integer;
  v_unique_settled integer;
  v_unique_terminal integer;
  v_unique_eligible integer;
  v_unique_pending integer;
  v_coverage numeric;
  v_status text;
  v_metrics jsonb;
  v_run uuid;
begin
  with selected_ids as (
    select * from public.cfi_prediction_fixture_identity_v1
    where target_date=p_target_date and selected_for_match_audit=true
  ), fixtures as (
    select distinct on (fixture_identity_key)
      fixture_identity_key,
      selected_representative_snapshot_id,
      selected_snapshot_count_for_fixture
    from selected_ids
    order by fixture_identity_key
  ), flags as (
    select f.*,
      exists(
        select 1
        from selected_ids si
        join public.cfi_prediction_terminal_resolutions t on t.snapshot_id=si.snapshot_id and t.immutable=true
        where si.fixture_identity_key=f.fixture_identity_key
      ) as terminal_excluded,
      coalesce(e.settlement_status='SETTLED',false) as representative_settled
    from fixtures f
    left join public.cfi_prediction_evaluation e on e.snapshot_id=f.selected_representative_snapshot_id
  )
  select
    (select count(*) from selected_ids),
    count(*),
    count(*) filter(where representative_settled and not terminal_excluded),
    count(*) filter(where terminal_excluded)
  into v_raw_selected,v_unique_selected,v_unique_settled,v_unique_terminal
  from flags;

  v_raw_selected := coalesce(v_raw_selected,0);
  v_unique_selected := coalesce(v_unique_selected,0);
  v_unique_settled := coalesce(v_unique_settled,0);
  v_unique_terminal := coalesce(v_unique_terminal,0);
  v_unique_eligible := greatest(v_unique_selected-v_unique_terminal,0);
  v_unique_pending := greatest(v_unique_eligible-v_unique_settled,0);
  v_coverage := case when v_unique_eligible=0 then 1 else v_unique_settled::numeric/v_unique_eligible end;
  v_status := case
    when v_unique_selected=0 then 'NO_PREDICTIONS'
    when v_unique_pending=0 and v_unique_settled=v_unique_eligible then 'COMPLETE'
    when v_unique_settled=0 and v_unique_eligible>0 then 'BLOCKED'
    else 'PARTIAL'
  end;

  with representatives as (
    select distinct on (i.fixture_identity_key)
      i.fixture_identity_key,i.selected_representative_snapshot_id
    from public.cfi_prediction_fixture_identity_v1 i
    where i.target_date=p_target_date and i.selected_for_match_audit=true
    order by i.fixture_identity_key
  ), terminal_keys as (
    select distinct i.fixture_identity_key
    from public.cfi_prediction_fixture_identity_v1 i
    join public.cfi_prediction_terminal_resolutions t on t.snapshot_id=i.snapshot_id and t.immutable=true
    where i.target_date=p_target_date and i.selected_for_match_audit=true
  ), settled as (
    select e.*,
      case e.rank_1_market
        when '3+ HT' then e.outcome_3plus_ht
        when '7+ FT' then e.outcome_7plus_ft
        when 'Other HT' then e.outcome_other_ht
        when 'Other FT' then e.outcome_other_ft
        else null
      end as rank1_outcome
    from representatives r
    join public.cfi_prediction_evaluation e on e.snapshot_id=r.selected_representative_snapshot_id
    left join terminal_keys t on t.fixture_identity_key=r.fixture_identity_key
    where t.fixture_identity_key is null and e.settlement_status='SETTLED'
  )
  select jsonb_build_object(
    'auditUnit','UNIQUE_FIXTURE',
    'rawSelectedSnapshots',v_raw_selected,
    'uniqueSelectedFixtures',v_unique_selected,
    'effectiveEligible',v_unique_eligible,
    'terminalExcluded',v_unique_terminal,
    'activePending',v_unique_pending,
    'duplicateSelectedSnapshots',greatest(v_raw_selected-v_unique_selected,0),
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
    'meanBrier',avg(mean_brier),
    'top1HT',jsonb_build_object('hit',count(*) filter(where top1_ht_hit is true),'miss',count(*) filter(where top1_ht_hit is false)),
    'top1FT',jsonb_build_object('hit',count(*) filter(where top1_ft_hit is true),'miss',count(*) filter(where top1_ft_hit is false)),
    'top3HT',jsonb_build_object('hit',count(*) filter(where top3_ht_hit is true),'miss',count(*) filter(where top3_ht_hit is false)),
    'top3FT',jsonb_build_object('hit',count(*) filter(where top3_ft_hit is true),'miss',count(*) filter(where top3_ft_hit is false)),
    'strongSignals',count(*) filter(where verdict='STRONG_SIGNAL'),
    'settledRows',count(*)
  ) into v_metrics
  from settled;

  insert into public.cfi_daily_prediction_audit_runs(target_date,selected_count,settled_count,pending_count,coverage,status,metrics)
  values(p_target_date,v_unique_selected,v_unique_settled,v_unique_pending,v_coverage,v_status,coalesce(v_metrics,'{}'::jsonb))
  returning run_id into v_run;

  return jsonb_build_object(
    'status','OK','runId',v_run,'targetDate',p_target_date,'auditUnit','UNIQUE_FIXTURE',
    'rawSelectedSnapshots',v_raw_selected,'selected',v_unique_selected,'eligible',v_unique_eligible,
    'settled',v_unique_settled,'terminalExcluded',v_unique_terminal,'pending',v_unique_pending,
    'coverage',v_coverage,'auditStatus',v_status,'metrics',v_metrics
  );
end;
$function$;

revoke execute on function public.cfi_capture_daily_prediction_audit(date) from public, anon, authenticated;
grant execute on function public.cfi_capture_daily_prediction_audit(date) to service_role;
