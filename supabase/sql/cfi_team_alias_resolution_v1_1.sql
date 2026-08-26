-- Curated exact aliases take precedence over duplicate/sparse canonical rows.
-- This is still deterministic exact resolution; no fuzzy match is introduced.
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

  select * into v_alias from public.team_aliases
  where alias_normalized = public.cfi_normalize_team_name(v_input) limit 1;
  if found then
    select * into v_team from public.teams where team_id = v_alias.team_id;
    return jsonb_build_object('status','RESOLVED','resolution','CURATED_ALIAS_EXACT',
      'team_id',v_team.team_id,'canonical_name',v_team.canonical_name,
      'confidence',v_alias.confidence,'source',v_alias.source);
  end if;

  select * into v_team from public.teams
  where lower(trim(canonical_name)) = lower(v_input) limit 1;
  if found then
    return jsonb_build_object('status','RESOLVED','resolution','CANONICAL_EXACT',
      'team_id',v_team.team_id,'canonical_name',v_team.canonical_name,'confidence',1.0);
  end if;

  return jsonb_build_object('status','UNRESOLVED','input',v_input,
    'normalized',public.cfi_normalize_team_name(v_input));
end;
$$;

grant execute on function public.cfi_resolve_team_name(text) to service_role;
