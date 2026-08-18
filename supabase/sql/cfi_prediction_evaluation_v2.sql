create or replace view public.cfi_prediction_evaluation as
select
  h.snapshot_id,
  h.target_date,
  h.home_team,
  h.away_team,
  h.created_at as prediction_created_at,
  h.engine_version,
  h.prediction_status,
  h.selected_for_match_audit,
  h.settlement_status,
  h.settled_at,
  h.verdict,
  (s.prediction->'ranking'->0->>'market') as rank_1_market,
  nullif(s.prediction->'ranking'->0->>'probability','')::numeric as rank_1_probability,
  nullif(h.final_3plus_ht,'')::numeric as final_3plus_ht,
  nullif(h.final_7plus_ft,'')::numeric as final_7plus_ft,
  nullif(h.final_other_ht,'')::numeric as final_other_ht,
  nullif(h.final_other_ft,'')::numeric as final_other_ft,
  h.actual_ht_home,
  h.actual_ht_away,
  h.actual_ft_home,
  h.actual_ft_away,
  case when h.settlement_status='SETTLED' then concat(h.actual_ht_home,'-',h.actual_ht_away) end as actual_ht_score,
  case when h.settlement_status='SETTLED' then concat(h.actual_ft_home,'-',h.actual_ft_away) end as actual_ft_score,
  case when h.settlement_status='SETTLED' then case when coalesce((h.actual_markets->>'3+ HT')::boolean,false) then 'HIT' else 'MISS' end end as outcome_3plus_ht,
  case when h.settlement_status='SETTLED' then case when coalesce((h.actual_markets->>'7+ FT')::boolean,false) then 'HIT' else 'MISS' end end as outcome_7plus_ft,
  case when h.settlement_status='SETTLED' then case when coalesce((h.actual_markets->>'Other HT')::boolean,false) then 'HIT' else 'MISS' end end as outcome_other_ht,
  case when h.settlement_status='SETTLED' then case when coalesce((h.actual_markets->>'Other FT')::boolean,false) then 'HIT' else 'MISS' end end as outcome_other_ft,
  nullif(h.market_brier->>'3+ HT','')::numeric as brier_3plus_ht,
  nullif(h.market_brier->>'7+ FT','')::numeric as brier_7plus_ft,
  nullif(h.market_brier->>'Other HT','')::numeric as brier_other_ht,
  nullif(h.market_brier->>'Other FT','')::numeric as brier_other_ft,
  case when h.market_brier is not null then (
    coalesce(nullif(h.market_brier->>'3+ HT','')::numeric,0)+
    coalesce(nullif(h.market_brier->>'7+ FT','')::numeric,0)+
    coalesce(nullif(h.market_brier->>'Other HT','')::numeric,0)+
    coalesce(nullif(h.market_brier->>'Other FT','')::numeric,0)
  )/4.0 end as mean_brier,
  h.top1_ht_hit,
  h.top1_ft_hit,
  case when h.settlement_status='SETTLED' then exists (
    select 1 from jsonb_array_elements(coalesce(h.top3_ht,'[]'::jsonb)) x
    where x->>'score'=concat(h.actual_ht_home,'-',h.actual_ht_away)
  ) end as top3_ht_hit,
  case when h.settlement_status='SETTLED' then exists (
    select 1 from jsonb_array_elements(coalesce(h.top3_ft,'[]'::jsonb)) x
    where x->>'score'=concat(h.actual_ft_home,'-',h.actual_ft_away)
  ) end as top3_ft_hit,
  h.top3_ht,
  h.top3_ft,
  h.most_likely_path,
  h.settlement_audit
from public.cfi_prediction_history h
join public.cfi_prediction_snapshots s on s.snapshot_id=h.snapshot_id;

create or replace function public.cfi_get_prediction_evaluation(
  p_target_date date default null,
  p_home_team text default null,
  p_away_team text default null,
  p_settlement_status text default null,
  p_selected_only boolean default true
)
returns setof public.cfi_prediction_evaluation
language sql stable security invoker
as $$
  select * from public.cfi_prediction_evaluation e
  where (p_target_date is null or e.target_date=p_target_date)
    and (p_home_team is null or lower(e.home_team)=lower(p_home_team))
    and (p_away_team is null or lower(e.away_team)=lower(p_away_team))
    and (p_settlement_status is null or e.settlement_status=p_settlement_status)
    and (not p_selected_only or e.selected_for_match_audit)
  order by e.target_date desc,e.prediction_created_at desc;
$$;
