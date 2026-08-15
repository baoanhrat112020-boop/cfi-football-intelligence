CREATE OR REPLACE FUNCTION public.cfi_upsert_fixture(p_match_date date, p_home_team text, p_away_team text, p_ht_home integer DEFAULT NULL::integer, p_ht_away integer DEFAULT NULL::integer, p_ft_home integer DEFAULT NULL::integer, p_ft_away integer DEFAULT NULL::integer, p_source_type text DEFAULT 'SCREENSHOT'::text, p_source_label text DEFAULT NULL::text, p_image_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_home uuid;
  v_away uuid;
  v_fixture fixtures%rowtype;
  v_action text;
begin

  if trim(p_home_team) = '' or trim(p_away_team) = '' then
    return jsonb_build_object(
      'status','REJECTED',
      'reason','TEAM_REQUIRED'
    );
  end if;

  if lower(trim(p_home_team)) = lower(trim(p_away_team)) then
    return jsonb_build_object(
      'status','REJECTED',
      'reason','SELF_VS_SELF'
    );
  end if;

  if ((p_ht_home is null) <> (p_ht_away is null))
     or ((p_ft_home is null) <> (p_ft_away is null)) then
    return jsonb_build_object(
      'status','REJECTED',
      'reason','PARTIAL_SCORE_PAIR'
    );
  end if;

  insert into teams(canonical_name)
  values(trim(p_home_team))
  on conflict(canonical_name) do nothing;

  select team_id into v_home
  from teams
  where canonical_name = trim(p_home_team);

  insert into teams(canonical_name)
  values(trim(p_away_team))
  on conflict(canonical_name) do nothing;

  select team_id into v_away
  from teams
  where canonical_name = trim(p_away_team);

  select *
  into v_fixture
  from fixtures
  where match_date = p_match_date
    and home_team_id = v_home
    and away_team_id = v_away;

  if not found then

    insert into fixtures(
      match_date,
      home_team_id,
      away_team_id,
      ht_home,
      ht_away,
      ft_home,
      ft_away,
      status
    )
    values(
      p_match_date,
      v_home,
      v_away,
      p_ht_home,
      p_ht_away,
      p_ft_home,
      p_ft_away,
      case
        when p_ht_home is null or p_ft_home is null
        then 'PARTIAL'
        else 'CANONICAL'
      end
    )
    returning * into v_fixture;

    v_action := 'NEW';

  else

    if
      (v_fixture.ht_home is not null and p_ht_home is not null and
        (v_fixture.ht_home <> p_ht_home or v_fixture.ht_away <> p_ht_away))
      or
      (v_fixture.ft_home is not null and p_ft_home is not null and
        (v_fixture.ft_home <> p_ft_home or v_fixture.ft_away <> p_ft_away))
    then

      insert into quarantine(
        match_date,
        home_team_name,
        away_team_name,
        existing_fixture,
        incoming_record,
        reason
      )
      values(
        p_match_date,
        p_home_team,
        p_away_team,
        to_jsonb(v_fixture),
        jsonb_build_object(
          'ht_home',p_ht_home,
          'ht_away',p_ht_away,
          'ft_home',p_ft_home,
          'ft_away',p_ft_away
        ),
        'SCORE_CONFLICT'
      );

      return jsonb_build_object(
        'status','CONFLICT',
        'fixture_id',v_fixture.fixture_id
      );

    end if;

    if
      v_fixture.ht_home is null and p_ht_home is not null
      or
      v_fixture.ft_home is null and p_ft_home is not null
    then

      update fixtures
      set
        ht_home = coalesce(ht_home,p_ht_home),
        ht_away = coalesce(ht_away,p_ht_away),
        ft_home = coalesce(ft_home,p_ft_home),
        ft_away = coalesce(ft_away,p_ft_away),
        status =
          case
            when coalesce(ht_home,p_ht_home) is not null
             and coalesce(ft_home,p_ft_home) is not null
            then 'CANONICAL'
            else 'PARTIAL'
          end,
        updated_at = now()
      where fixture_id = v_fixture.fixture_id
      returning * into v_fixture;

      v_action := 'COMPLEMENTARY';

    else
      v_action := 'DUPLICATE_COMPATIBLE';
    end if;

  end if;

  insert into provenance(
    fixture_id,
    source_type,
    source_label,
    image_hash
  )
  values(
    v_fixture.fixture_id,
    p_source_type,
    p_source_label,
    p_image_hash
  )
  on conflict do nothing;

  return jsonb_build_object(
    'status',v_action,
    'fixture_id',v_fixture.fixture_id
  );

end;
$function$