-- Follow-up: canonical alias resolution for the two known 2026-09-05 audit-name variants
-- and Asia/Ho_Chi_Minh completed-day enforcement.
select public.cfi_upsert_team_alias('Renofa Yamaguchi FC','Renofa Yamaguchi','RESEARCH_REPLAY_CANONICAL_BRIDGE',1.0);
select public.cfi_upsert_team_alias('Jeonbuk Hyundai Motors','Jeonbuk Hyundai Motors FC','RESEARCH_REPLAY_CANONICAL_BRIDGE',1.0);

create or replace function public.cfi_research_replay_audit_range(p_from date,p_to date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_batch uuid:=gen_random_uuid();
  r record;
  pred jsonb;
  probs jsonb;
  track text;
  model text;
  targets integer:=0;
  predictions integer:=0;
  evaluated integer:=0;
  skipped integer:=0;
  errors integer:=0;
  max_ev date;
  ev_count integer;
  ah integer; aa integer; fh integer; fa integer;
  y3 integer; y7 integer; yoh integer; yof integer;
  p3 double precision; p7 double precision; poh double precision; pof double precision;
  b3 double precision; b7 double precision; boh double precision; bof double precision; mb double precision;
  ht1 text; ft1 text;
begin
  if p_from is null or p_to is null or p_from>p_to then raise exception 'INVALID_REPLAY_RANGE'; end if;
  if p_to-p_from>6 then raise exception 'REPLAY_RANGE_MAX_7_DAYS'; end if;
  if p_to >= (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'COMPLETED_DAYS_ONLY'; end if;

  insert into public.cfi_research_historical_replay_batches(batch_id,from_date,to_date,details)
  values(v_batch,p_from,p_to,jsonb_build_object(
    'mode','HISTORICAL_REPLAY_NOT_PREMATCH',
    'strictCutoff','EVIDENCE_DATE_LT_TARGET_DATE',
    'sourceCohort','SELECTED_IMMUTABLE_AUDIT_SNAPSHOTS',
    'models',jsonb_build_array('FUTURE_SIX_CALIBRATED','FUTURE_SIX_STRUCTURAL','FUTURE_SIX_EMPIRICAL_RAW'),
    'canonicalResolution','EXACT_THEN_VERIFIED_ALIAS',
    'noProductionSnapshotWrite',true,
    'noAutoPromotion',true
  ));

  for r in
    select distinct on (h.target_date,h.home_team,h.away_team)
      h.snapshot_id,h.target_date,h.home_team,h.away_team,h.actual_ht_home,h.actual_ht_away,h.actual_ft_home,h.actual_ft_away,
      coalesce(th.team_id,tha.team_id) as home_id,
      coalesce(ta.team_id,taa.team_id) as away_id
    from public.cfi_prediction_history h
    left join public.teams th on th.canonical_name=h.home_team
    left join public.team_aliases ha on ha.alias_normalized=public.cfi_normalize_team_name(h.home_team)
    left join public.teams tha on tha.team_id=ha.team_id
    left join public.teams ta on ta.canonical_name=h.away_team
    left join public.team_aliases aa2 on aa2.alias_normalized=public.cfi_normalize_team_name(h.away_team)
    left join public.teams taa on taa.team_id=aa2.team_id
    where h.selected_for_match_audit is true and h.target_date between p_from and p_to
    order by h.target_date,h.home_team,h.away_team,h.prediction_created_at asc
  loop
    targets:=targets+1;
    if r.home_id is null or r.away_id is null then
      skipped:=skipped+1;
      insert into public.cfi_research_historical_replays(batch_id,source_snapshot_id,target_date,home_team,away_team,canonical_home_team_id,canonical_away_team_id,model_name,probability_track,replay_status,error)
      values(v_batch,r.snapshot_id,r.target_date,r.home_team,r.away_team,r.home_id,r.away_id,'FUTURE_SIX','UNMAPPED','SKIPPED','CANONICAL_TEAM_MAPPING_REQUIRED');
      continue;
    end if;

    begin
      pred:=public.cfi_research_future_six_live(r.home_id,r.away_id,r.target_date);
      max_ev:=(pred->>'maxEvidenceDate')::date;
      ev_count:=coalesce((pred->>'evidenceCount')::integer,0);
      if max_ev is null or max_ev>=r.target_date then raise exception 'STRICT_PRIOR_MAX_EVIDENCE_INVALID'; end if;
      if coalesce((pred#>>'{provenance,futureEvidenceCount}')::integer,-1)<>0 or coalesce((pred#>>'{provenance,sameDateEvidenceCount}')::integer,-1)<>0 then raise exception 'STRICT_PRIOR_PROVENANCE_FAILURE'; end if;

      ah:=r.actual_ht_home; aa:=r.actual_ht_away; fh:=r.actual_ft_home; fa:=r.actual_ft_away;
      if ah is not null and aa is not null and fh is not null and fa is not null then
        y3:=(ah+aa>=3)::integer; y7:=(fh+fa>=7)::integer; yoh:=(ah>=4 or aa>=4)::integer; yof:=(fh>=5 or fa>=5)::integer;
      else y3:=null; y7:=null; yoh:=null; yof:=null; end if;
      ht1:=pred#>>'{top3HT,0,score}'; ft1:=pred#>>'{top3FT,0,score}';

      foreach track in array array['probabilities','structural','rawRates'] loop
        if track='probabilities' then model:='FUTURE_SIX_CALIBRATED';
        elsif track='structural' then model:='FUTURE_SIX_STRUCTURAL';
        else model:='FUTURE_SIX_EMPIRICAL_RAW'; end if;
        probs:=pred->track;
        p3:=(probs->>'3+ HT')::double precision; p7:=(probs->>'7+ FT')::double precision; poh:=(probs->>'Other HT')::double precision; pof:=(probs->>'Other FT')::double precision;
        if y3 is not null then
          b3:=power(p3-y3,2); b7:=power(p7-y7,2); boh:=power(poh-yoh,2); bof:=power(pof-yof,2); mb:=(b3+b7+boh+bof)/4.0;
        else b3:=null;b7:=null;boh:=null;bof:=null;mb:=null; end if;
        insert into public.cfi_research_historical_replays(
          batch_id,source_snapshot_id,target_date,home_team,away_team,canonical_home_team_id,canonical_away_team_id,
          model_name,model_version,probability_track,p_3plus_ht,p_7plus_ft,p_other_ht,p_other_ft,max_evidence_date,evidence_count,
          strict_prior,research_only,decision_use,production_mutation_allowed,
          actual_ht_home,actual_ht_away,actual_ft_home,actual_ft_away,y_3plus_ht,y_7plus_ft,y_other_ht,y_other_ft,
          brier_3plus_ht,brier_7plus_ft,brier_other_ht,brier_other_ft,mean_brier,top1_ht_hit,top1_ft_hit,replay_status,prediction
        ) values(
          v_batch,r.snapshot_id,r.target_date,r.home_team,r.away_team,r.home_id,r.away_id,
          model,pred->>'version',track,p3,p7,poh,pof,max_ev,ev_count,true,true,false,false,
          ah,aa,fh,fa,y3,y7,yoh,yof,b3,b7,boh,bof,mb,
          case when y3 is null then null else ht1=(ah::text||'-'||aa::text) end,
          case when y3 is null then null else ft1=(fh::text||'-'||fa::text) end,
          case when y3 is null then 'PREDICTED_REPLAY_ONLY' else 'EVALUATED' end,pred
        );
        predictions:=predictions+1;
        if y3 is not null then evaluated:=evaluated+1; end if;
      end loop;
    exception when others then
      errors:=errors+1;
      insert into public.cfi_research_historical_replays(batch_id,source_snapshot_id,target_date,home_team,away_team,canonical_home_team_id,canonical_away_team_id,model_name,probability_track,replay_status,error)
      values(v_batch,r.snapshot_id,r.target_date,r.home_team,r.away_team,r.home_id,r.away_id,'FUTURE_SIX','ERROR','ERROR',left(sqlerrm,1000));
    end;
  end loop;

  update public.cfi_research_historical_replay_batches
  set status=case when errors=0 and skipped=0 then 'SUCCESS'::public.cfi_research_replay_status else 'PARTIAL'::public.cfi_research_replay_status end,
      target_count=targets,prediction_count=predictions,evaluated_count=evaluated,skipped_count=skipped,error_count=errors,
      completed_at=now(),details=details||jsonb_build_object('completed',true)
  where batch_id=v_batch;

  return jsonb_build_object('status',case when errors=0 and skipped=0 then 'SUCCESS' else 'PARTIAL' end,'batchId',v_batch,'fromDate',p_from,'toDate',p_to,'targets',targets,'predictions',predictions,'evaluated',evaluated,'skipped',skipped,'errors',errors,'researchOnly',true,'decisionUse',false,'productionMutationAllowed',false,'contract','CFI_HISTORICAL_STRICT_PRIOR_REPLAY_V1');
exception when others then
  update public.cfi_research_historical_replay_batches set status='ERROR',error_count=errors+1,completed_at=now(),details=details||jsonb_build_object('fatal',sqlerrm) where batch_id=v_batch;
  raise;
end;
$$;

revoke execute on function public.cfi_research_replay_audit_range(date,date) from public,anon,authenticated;
grant execute on function public.cfi_research_replay_audit_range(date,date) to service_role;
