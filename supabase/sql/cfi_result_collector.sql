-- CFI unattended result collector audit state.
-- Production scheduler calls cfi-current-refresh hourly; that function invokes
-- cfi-result-collector before settlement and calibration learning.

create table if not exists public.cfi_result_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.cfi_prediction_snapshots(snapshot_id) on delete cascade,
  source text not null,
  source_event_id text not null,
  match_date date not null,
  home_team text not null,
  away_team text not null,
  external_home_team text not null,
  external_away_team text not null,
  name_confidence numeric not null,
  ht_home integer not null,
  ht_away integer not null,
  ft_home integer not null,
  ft_away integer not null,
  verification_method text not null,
  status text not null check (status in ('VERIFIED','PENDING','CONFLICT','REJECTED')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(snapshot_id, source, source_event_id)
);

alter table public.cfi_result_resolutions enable row level security;
revoke all on table public.cfi_result_resolutions from anon, authenticated;
create index if not exists cfi_result_resolutions_snapshot_idx on public.cfi_result_resolutions(snapshot_id, created_at desc);
create index if not exists cfi_result_resolutions_match_idx on public.cfi_result_resolutions(match_date, home_team, away_team);

create table if not exists public.cfi_result_collector_runs (
  run_id uuid primary key default gen_random_uuid(),
  checked integer not null default 0,
  verified integer not null default 0,
  pending integer not null default 0,
  rejected integer not null default 0,
  conflicts integer not null default 0,
  upserted integer not null default 0,
  settled integer not null default 0,
  outcomes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.cfi_result_collector_runs enable row level security;
revoke all on table public.cfi_result_collector_runs from anon, authenticated;
create index if not exists cfi_result_collector_runs_created_idx on public.cfi_result_collector_runs(created_at desc);
