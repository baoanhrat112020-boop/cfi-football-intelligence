-- CFI v2.1 Screenshot Intelligence Merge Engine
-- Additive only: frozen public.cfi_upsert_fixture remains the canonical authority.

create table if not exists public.team_aliases (
  alias_normalized text primary key,
  alias_display text not null,
  team_id uuid not null references public.teams(team_id) on delete cascade,
  source text not null default 'MANUAL',
  confidence numeric(5,4) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_aliases_team_id_idx
  on public.team_aliases(team_id);

create index if not exists fixtures_home_match_date_idx
  on public.fixtures(home_team_id, match_date desc);

create index if not exists fixtures_away_match_date_idx
  on public.fixtures(away_team_id, match_date desc);

create index if not exists fixtures_match_pair_idx
  on public.fixtures(match_date, home_team_id, away_team_id);

create index if not exists provenance_fixture_id_idx
  on public.provenance(fixture_id);

create or replace function public.cfi_normalize_team_name(p_name text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(p_name,'')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.cfi_resolve_team_name(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input text := trim(coalesce(p_name,''));
  v_norm text;
  v_team teams%rowtype;
  v_alias team_aliases%rowtype;
begin
  if v_input = '' then
    return jsonb_build_object('status','REJECTED','reason','TEAM_REQUIRED');
  end if;

  -- Exact canonical match is always preferred and never fuzzy.
  select * into v_team
  from teams
  where lower(trim(canonical_name)) = lower(v_input)
  limit 1;

  if found then
    return jsonb_build_object(
      'status','RESOLVED',
      'resolution','CANONICAL_EXACT',
      'team_id',v_team.team_id,
      'canonical_name',v_team.canonical_name,
      'confidence',1.0
    );
  end if;

  v_norm := cfi_normalize_team_name(v_input);

  select * into v_alias
  from team_aliases
  where alias_normalized = v_norm
  limit 1;

  if found then
    select * into v_team from teams where team_id = v_alias.team_id;
    return jsonb_build_object(
      'status','RESOLVED',
      'resolution','ALIAS_EXACT',
      'team_id',v_team.team_id,
      'canonical_name',v_team.canonical_name,
      'confidence',v_alias.confidence
    );
  end if;

  return jsonb_build_object(
    'status','UNRESOLVED',
    'input',v_input,
    'normalized',v_norm
  );
end;
$$;

create or replace function public.cfi_upsert_team_alias(
  p_alias text,
  p_canonical_name text,
  p_source text default 'CFI',
  p_confidence numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_norm text;
begin
  if trim(coalesce(p_alias,'')) = '' or trim(coalesce(p_canonical_name,'')) = '' then
    return jsonb_build_object('status','REJECTED','reason','NAME_REQUIRED');
  end if;

  select * into v_team
  from teams
  where lower(trim(canonical_name)) = lower(trim(p_canonical_name))
  limit 1;

  if not found then
    return jsonb_build_object('status','REJECTED','reason','CANONICAL_TEAM_NOT_FOUND');
  end if;

  v_norm := cfi_normalize_team_name(p_alias);

  insert into team_aliases(alias_normalized, alias_display, team_id, source, confidence)
  values(v_norm, trim(p_alias), v_team.team_id, coalesce(nullif(trim(p_source),''),'CFI'), least(greatest(p_confidence,0),1))
  on conflict(alias_normalized) do update
    set alias_display = excluded.alias_display,
        team_id = excluded.team_id,
        source = excluded.source,
        confidence = excluded.confidence,
        updated_at = now();

  return jsonb_build_object('status','OK','team_id',v_team.team_id,'canonical_name',v_team.canonical_name);
end;
$$;

create or replace function public.cfi_ingest_fixture_v2(
  p_match_date date,
  p_home_team text,
  p_away_team text,
  p_ht_home integer default null,
  p_ht_away integer default null,
  p_ft_home integer default null,
  p_ft_away integer default null,
  p_source_type text default 'SCREENSHOT',
  p_source_label text default null,
  p_image_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home jsonb;
  v_away jsonb;
  v_home_name text;
  v_away_name text;
  v_result jsonb;
begin
  if p_match_date is null then
    return jsonb_build_object('status','REJECTED','reason','MATCH_DATE_REQUIRED');
  end if;

  -- Never fabricate partial score pairs.
  if ((p_ht_home is null) <> (p_ht_away is null))
     or ((p_ft_home is null) <> (p_ft_away is null)) then
    return jsonb_build_object('status','REJECTED','reason','PARTIAL_SCORE_PAIR');
  end if;

  if coalesce(p_ht_home,0) < 0 or coalesce(p_ht_away,0) < 0
     or coalesce(p_ft_home,0) < 0 or coalesce(p_ft_away,0) < 0 then
    return jsonb_build_object('status','REJECTED','reason','NEGATIVE_SCORE');
  end if;

  if p_ht_home is not null and p_ft_home is not null
     and (p_ht_home > p_ft_home or p_ht_away > p_ft_away) then
    return jsonb_build_object('status','REJECTED','reason','IMPOSSIBLE_HT_FT');
  end if;

  v_home := cfi_resolve_team_name(p_home_team);
  v_away := cfi_resolve_team_name(p_away_team);

  -- Unknown team names are allowed to become new canonical teams only when they are
  -- not known aliases. No fuzzy merge is performed automatically.
  v_home_name := case when v_home->>'status' = 'RESOLVED' then v_home->>'canonical_name' else trim(p_home_team) end;
  v_away_name := case when v_away->>'status' = 'RESOLVED' then v_away->>'canonical_name' else trim(p_away_team) end;

  if lower(v_home_name) = lower(v_away_name) then
    return jsonb_build_object('status','REJECTED','reason','SELF_VS_SELF');
  end if;

  v_result := public.cfi_upsert_fixture(
    p_match_date,
    v_home_name,
    v_away_name,
    p_ht_home,
    p_ht_away,
    p_ft_home,
    p_ft_away,
    coalesce(nullif(trim(p_source_type),''),'SCREENSHOT'),
    p_source_label,
    p_image_hash
  );

  return v_result || jsonb_build_object(
    'home_canonical',v_home_name,
    'away_canonical',v_away_name,
    'home_resolution',coalesce(v_home->>'resolution','NEW_CANONICAL'),
    'away_resolution',coalesce(v_away->>'resolution','NEW_CANONICAL')
  );
end;
$$;
