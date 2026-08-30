alter table public.cfi_prediction_settlements
  add column if not exists top1_ht_hit boolean generated always as (scoreline_hit_ht) stored,
  add column if not exists top1_ft_hit boolean generated always as (scoreline_hit_ft) stored;

comment on column public.cfi_prediction_settlements.top1_ht_hit is 'Primary Top-1 HT exact-score hit. Generated from immutable scoreline_hit_ht; legacy top3_* columns remain compatibility-only.';
comment on column public.cfi_prediction_settlements.top1_ft_hit is 'Primary Top-1 FT exact-score hit. Generated from immutable scoreline_hit_ft; legacy top3_* columns remain compatibility-only.';
