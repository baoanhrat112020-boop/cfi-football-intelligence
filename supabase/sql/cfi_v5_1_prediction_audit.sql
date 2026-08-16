-- CFI v5.1 — immutable prediction snapshot + automatic settlement/audit loop.
-- This migration never changes canonical fixture/upsert semantics.

create extension if not exists pgcrypto;

create table if not exists public.cfi_prediction_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  target_date date not null,
  home_team text not null,
  away_team text not null,
  engine_version text not null,
  language text not null default 'vi',
  strict_prior boolean not null default true,
  prediction jsonb not null,
  prediction_hash text not null,
  source text not null default 'GPT_ACTION',
  constraint cfi_prediction_snapshots_team_check check (btrim(home_team) <> '' and btrim(away_team) <> ''),
  constraint cfi_prediction_snapshots_distinct_teams check (lower(btrim(home_team)) <> lower(btrim(away_team))),
  unique (target_date, lower(btrim(home_team)), lower(btrim(away_team)), prediction_hash)
);

create index if not exists cfi_prediction_snapshots_target_idx
  on public.cfi_prediction_snapshots(target_date, home_team, away_team);

create table if not exists public.cfi_prediction_settlements (
  snapshot_id uuid primary key references public.cfi_prediction_snapshots(snapshot_id) on delete restrict,
  fixture_id uuid not null,
  settled_at timestamptz not null default now(),
  actual_ht_home integer not null,
  actual_ht_away integer not null,
  actual_ft_home integer not null,
  actual_ft_away integer not null,
  actual_markets jsonb not null,
  market_brier jsonb not null,
  scoreline_hit_ht boolean not null,
  scoreline_hit_ft boolean not null,
  audit jsonb not null default '{}'::jsonb
);

create index if not exists cfi_prediction_settlements_settled_idx
  on public.cfi_prediction_settlements(settled_at desc);

create or replace function public.cfi_record_prediction_snapshot(
  p_target_date date,
  p_home_team text,
  p_away_team text,
  p_engine_version text,
  p_language text,
  p_strict_prior boolean,
  p_prediction jsonb,
  p_prediction_hash text,
  p_source text default 'GPT_ACTION'
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  if p_target_date is null or btrim(coalesce(p_home_team,''))='' or btrim(coalesce(p_away_team,''))='' then
    return jsonb_build_object('status','REJECTED','reason','TARGET_AND_TEAMS_REQUIRED');
  end if;
  if p_prediction is null or p_prediction_hash is null or btrim(p_prediction_hash)='' then
    return jsonb_build_object('status','REJECTED','reason','PREDICTION_AND_HASH_REQUIRED');
  end if;

  insert into public.cfi_prediction_snapshots(
    target_date,home_team,away_team,engine_version,language,strict_prior,prediction,prediction_hash,source
  ) values (
    p_target_date,btrim(p_home_team),btrim(p_away_team),p_engine_version,coalesce(nullif(p_language,''),'vi'),coalesce(p_strict_prior,true),p_prediction,p_prediction_hash,coalesce(nullif(p_source,''),'GPT_ACTION')
  )
  on conflict (target_date, lower(btrim(home_team)), lower(btrim(away_team)), prediction_hash)
  do update set prediction_hash=excluded.prediction_hash
  returning snapshot_id into v_id;

  return jsonb_build_object('status','RECORDED','snapshotId',v_id);
end;
$$;

create or replace function public.cfi_settle_prediction_snapshots()
returns jsonb
language plpgsql
security definer
as $$
declare
  r record;
  v_actual jsonb;
  v_brier jsonb;
  v_ht_top text;
  v_ft_top text;
  v_count integer := 0;
begin
  for r in
    select s.*, f.fixture_id, f.ht_home, f.ht_away, f.ft_home, f.ft_away
    from public.cfi_prediction_snapshots s
    join public.teams th on lower(btrim(th.canonical_name)) = lower(btrim(s.home_team))
    join public.teams ta on lower(btrim(ta.canonical_name)) = lower(btrim(s.away_team))
    join public.fixtures f
      on f.match_date = s.target_date
     and f.home_team_id = th.team_id
     and f.away_team_id = ta.team_id
    left join public.cfi_prediction_settlements st on st.snapshot_id = s.snapshot_id
    where st.snapshot_id is null
      and f.ht_home is not null and f.ht_away is not null
      and f.ft_home is not null and f.ft_away is not null
      and f.status in ('CANONICAL','COMPLETE')
  loop
    v_actual := jsonb_build_object(
      '3+ HT', ((r.ht_home+r.ht_away)>=3),
      '7+ FT', ((r.ft_home+r.ft_away)>=7),
      'Other HT', (r.ht_home>=4 or r.ht_away>=4),
      'Other FT', (r.ft_home>=5 or r.ft_away>=5)
    );

    v_brier := jsonb_build_object(
      '3+ HT', power(coalesce((r.prediction#>>'{markets,3+ HT,final}')::numeric,0) - case when (r.ht_home+r.ht_away)>=3 then 1 else 0 end, 2),
      '7+ FT', power(coalesce((r.prediction#>>'{markets,7+ FT,final}')::numeric,0) - case when (r.ft_home+r.ft_away)>=7 then 1 else 0 end, 2),
      'Other HT', power(coalesce((r.prediction#>>'{markets,Other HT,final}')::numeric,0) - case when (r.ht_home>=4 or r.ht_away>=4) then 1 else 0 end, 2),
      'Other FT', power(coalesce((r.prediction#>>'{markets,Other FT,final}')::numeric,0) - case when (r.ft_home>=5 or r.ft_away>=5) then 1 else 0 end, 2)
    );

    v_ht_top := r.prediction#>>'{scoreline,ht,0,score}';
    v_ft_top := r.prediction#>>'{scoreline,ft,0,score}';

    insert into public.cfi_prediction_settlements(
      snapshot_id,fixture_id,actual_ht_home,actual_ht_away,actual_ft_home,actual_ft_away,
      actual_markets,market_brier,scoreline_hit_ht,scoreline_hit_ft,audit
    ) values (
      r.snapshot_id,r.fixture_id,r.ht_home,r.ht_away,r.ft_home,r.ft_away,
      v_actual,v_brier,
      v_ht_top = format('%s-%s',r.ht_home,r.ht_away),
      v_ft_top = format('%s-%s',r.ft_home,r.ft_away),
      jsonb_build_object('engine',r.engine_version,'predictionCreatedAt',r.created_at,'settledFrom','CANONICAL_FIXTURE')
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('status','OK','settled',v_count);
end;
$$;

create or replace view public.cfi_prediction_audit_summary as
select
  count(*) as settled_predictions,
  avg((market_brier->>'3+ HT')::numeric) as brier_3plus_ht,
  avg((market_brier->>'7+ FT')::numeric) as brier_7plus_ft,
  avg((market_brier->>'Other HT')::numeric) as brier_other_ht,
  avg((market_brier->>'Other FT')::numeric) as brier_other_ft,
  avg(case when scoreline_hit_ht then 1 else 0 end)::numeric as top1_ht_accuracy,
  avg(case when scoreline_hit_ft then 1 else 0 end)::numeric as top1_ft_accuracy,
  max(settled_at) as last_settled_at
from public.cfi_prediction_settlements;
