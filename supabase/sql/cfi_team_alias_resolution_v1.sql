-- Deterministic, auditable team-name resolution for search-first discovery.
-- Aliases are exact after normalization; no fuzzy matching is permitted.

create table if not exists public.team_aliases (
  alias_normalized text primary key,
  alias_display text not null,
  team_id uuid not null references public.teams(team_id) on delete cascade,
  source text not null,
  confidence numeric(5,4) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_aliases enable row level security;
create index if not exists team_aliases_team_id_idx on public.team_aliases(team_id);

create or replace function public.cfi_normalize_team_name(p_name text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p_name,'')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.cfi_resolve_team_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_input text := trim(coalesce(p_name,''));
  v_team public.teams%rowtype;
  v_alias public.team_aliases%rowtype;
begin
  if v_input = '' then
    return jsonb_build_object('status','REJECTED','reason','TEAM_REQUIRED');
  end if;

  select * into v_team from public.teams
  where lower(trim(canonical_name)) = lower(v_input) limit 1;
  if found then
    return jsonb_build_object('status','RESOLVED','resolution','CANONICAL_EXACT',
      'team_id',v_team.team_id,'canonical_name',v_team.canonical_name,'confidence',1.0);
  end if;

  select * into v_alias from public.team_aliases
  where alias_normalized = public.cfi_normalize_team_name(v_input) limit 1;
  if found then
    select * into v_team from public.teams where team_id = v_alias.team_id;
    return jsonb_build_object('status','RESOLVED','resolution','ALIAS_EXACT',
      'team_id',v_team.team_id,'canonical_name',v_team.canonical_name,
      'confidence',v_alias.confidence,'source',v_alias.source);
  end if;

  return jsonb_build_object('status','UNRESOLVED','input',v_input,
    'normalized',public.cfi_normalize_team_name(v_input));
end;
$$;

create or replace function public.cfi_upsert_team_alias(
  p_alias text, p_canonical_name text, p_source text default 'CFI_VERIFIED',
  p_confidence numeric default 1.0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team public.teams%rowtype;
  v_norm text;
begin
  if trim(coalesce(p_alias,'')) = '' or trim(coalesce(p_canonical_name,'')) = '' then
    return jsonb_build_object('status','REJECTED','reason','NAME_REQUIRED');
  end if;
  select * into v_team from public.teams
  where lower(trim(canonical_name)) = lower(trim(p_canonical_name)) limit 1;
  if not found then
    return jsonb_build_object('status','REJECTED','reason','CANONICAL_TEAM_NOT_FOUND');
  end if;
  v_norm := public.cfi_normalize_team_name(p_alias);
  insert into public.team_aliases(alias_normalized,alias_display,team_id,source,confidence)
  values(v_norm,trim(p_alias),v_team.team_id,coalesce(nullif(trim(p_source),''),'CFI_VERIFIED'),least(greatest(p_confidence,0),1))
  on conflict(alias_normalized) do update set
    alias_display=excluded.alias_display,team_id=excluded.team_id,source=excluded.source,
    confidence=excluded.confidence,updated_at=now();
  return jsonb_build_object('status','OK','team_id',v_team.team_id,'canonical_name',v_team.canonical_name);
end;
$$;

select public.cfi_upsert_team_alias(v.alias, v.canonical, 'CFI_VERIFIED_COMMON_NAME', 1.0)
from (values
  ('Bradford City','Bradford'),
  ('Real Sociedad','Sociedad'),
  ('Tottenham Hotspur','Tottenham'),
  ('Charlton Athletic','Charlton'),
  ('Newcastle United','Newcastle'),
  ('West Bromwich Albion','West Brom'),
  ('Preston North End','Preston'),
  ('Olympique Lyonnais','Lyon'),
  ('Fenerbahçe','Fenerbahce'),
  ('Heart of Midlothian','Hearts')
) as v(alias,canonical);

revoke all on public.team_aliases from anon, authenticated;
revoke all on function public.cfi_upsert_team_alias(text,text,text,numeric) from public;
grant execute on function public.cfi_resolve_team_name(text) to service_role;
grant execute on function public.cfi_upsert_team_alias(text,text,text,numeric) to service_role;
