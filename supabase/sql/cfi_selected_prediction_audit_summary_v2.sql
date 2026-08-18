create or replace view public.cfi_selected_prediction_audit_summary as
with e as (
  select * from public.cfi_prediction_evaluation
  where selected_for_match_audit=true and settlement_status='SETTLED'
)
select
  count(*)::bigint as settled_predictions,
  avg(brier_3plus_ht)::numeric as brier_3plus_ht,
  avg(brier_7plus_ft)::numeric as brier_7plus_ft,
  avg(brier_other_ht)::numeric as brier_other_ht,
  avg(brier_other_ft)::numeric as brier_other_ft,
  avg(mean_brier)::numeric as mean_brier,
  avg(case when top1_ht_hit then 1.0 else 0.0 end)::numeric as top1_ht_accuracy,
  avg(case when top3_ht_hit then 1.0 else 0.0 end)::numeric as top3_ht_accuracy,
  avg(case when top1_ft_hit then 1.0 else 0.0 end)::numeric as top1_ft_accuracy,
  avg(case when top3_ft_hit then 1.0 else 0.0 end)::numeric as top3_ft_accuracy,
  max(settled_at) as last_settled_at
from e;
