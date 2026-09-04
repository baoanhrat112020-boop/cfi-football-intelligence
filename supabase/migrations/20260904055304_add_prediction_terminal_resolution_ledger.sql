create table if not exists public.cfi_prediction_terminal_resolutions(
  snapshot_id uuid primary key references public.cfi_prediction_snapshots(snapshot_id),
  target_date date not null,
  home_team text not null,
  away_team text not null,
  terminal_status text not null check (terminal_status in ('POSTPONED','CANCELLED','ABANDONED')),
  source_count integer not null check (source_count >= 2),
  sources text[] not null,
  evidence jsonb not null,
  immutable boolean not null default true,
  resolved_at timestamptz not null default now()
);

alter table public.cfi_prediction_terminal_resolutions enable row level security;
revoke all on public.cfi_prediction_terminal_resolutions from public, anon, authenticated;
grant select,insert,update on public.cfi_prediction_terminal_resolutions to service_role;
