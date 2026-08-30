create table if not exists public.cfi_agent_social_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  min_interval_hours integer not null default 12 check (min_interval_hours between 1 and 168),
  agent_username text not null default 'cfi-football-agent-26',
  display_name text not null default 'CFI Football Intelligence',
  bio text not null default 'Human-operated CFI Football Intelligence research agent focused on strict-prior probabilistic football forecasting, Multi-Market evaluation, calibration, provenance, and prospective validation.',
  publish_historical_runs boolean not null default true,
  publish_verified_candidates boolean not null default true,
  publish_prospective_milestones boolean not null default true,
  enable_the_colony boolean not null default true,
  enable_agent_community boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.cfi_agent_social_config(singleton) values(true) on conflict (singleton) do nothing;

create table if not exists public.cfi_agent_social_credentials (
  platform text primary key check (platform in ('THE_COLONY','AGENT_COMMUNITY')),
  agent_id text,
  agent_username text not null,
  api_key_ciphertext text not null,
  iv_b64 text not null,
  credential_status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cfi_agent_social_publish_log (
  publish_id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('THE_COLONY','AGENT_COMMUNITY')),
  fingerprint text not null,
  source_type text not null,
  source_ref text,
  title text not null,
  content text not null,
  status text not null check (status in ('POSTED','FAILED','BLOCKED','SKIPPED')),
  remote_post_id text,
  remote_post_url text,
  http_status integer,
  error text,
  response_excerpt text,
  attempted_at timestamptz not null default now(),
  posted_at timestamptz
);
create unique index if not exists cfi_agent_social_posted_unique
  on public.cfi_agent_social_publish_log(platform,fingerprint)
  where status='POSTED';
create index if not exists cfi_agent_social_log_platform_time_idx
  on public.cfi_agent_social_publish_log(platform, attempted_at desc);

alter table public.cfi_agent_social_config enable row level security;
alter table public.cfi_agent_social_credentials enable row level security;
alter table public.cfi_agent_social_publish_log enable row level security;
revoke all on public.cfi_agent_social_config from anon, authenticated;
revoke all on public.cfi_agent_social_credentials from anon, authenticated;
revoke all on public.cfi_agent_social_publish_log from anon, authenticated;

insert into public.cfi_scheduler_tokens(token_name, token)
values ('agent_social_publisher', encode(gen_random_bytes(32),'hex'))
on conflict (token_name) do nothing;