create or replace function public.cfi_upsert_fixtures_batch(
  p_fixtures jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  result jsonb;
  status_text text;

  c_rows integer := 0;
  c_new integer := 0;
  c_dup integer := 0;
  c_comp integer := 0;
  c_conflict integer := 0;
  c_rejected integer := 0;
  c_error integer := 0;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' then
    return jsonb_build_object(
      'status', 'ERROR',
      'reason', 'FIXTURES_ARRAY_REQUIRED'
    );
  end if;

  if jsonb_array_length(p_fixtures) > 500 then
    return jsonb_build_object(
      'status', 'ERROR',
      'reason', 'MAX_500_FIXTURES'
    );
  end if;

  for item in
    select value from jsonb_array_elements(p_fixtures)
  loop
    c_rows := c_rows + 1;

    begin
      result := public.cfi_upsert_fixture(
        (item->>'matchDate')::date,
        item->>'homeTeam',
        item->>'awayTeam',
        case when item->'ht'->>'home' is null then null else (item->'ht'->>'home')::integer end,
        case when item->'ht'->>'away' is null then null else (item->'ht'->>'away')::integer end,
        case when item->'ft'->>'home' is null then null else (item->'ft'->>'home')::integer end,
        case when item->'ft'->>'away' is null then null else (item->'ft'->>'away')::integer end,
        coalesce(item->>'sourceType', 'CSV'),
        item->>'sourceLabel',
        item->>'imageHash'
      );

      status_text := result->>'status';

      case status_text
        when 'NEW' then c_new := c_new + 1;
        when 'DUPLICATE_COMPATIBLE' then c_dup := c_dup + 1;
        when 'COMPLEMENTARY' then c_comp := c_comp + 1;
        when 'CONFLICT' then c_conflict := c_conflict + 1;
        when 'REJECTED' then c_rejected := c_rejected + 1;
        else c_error := c_error + 1;
      end case;
    exception
      when others then
        c_error := c_error + 1;
    end;
  end loop;

  return jsonb_build_object(
    'status', 'OK',
    'counters', jsonb_build_object(
      'rows', c_rows,
      'NEW', c_new,
      'DUPLICATE_COMPATIBLE', c_dup,
      'COMPLEMENTARY', c_comp,
      'CONFLICT', c_conflict,
      'REJECTED', c_rejected,
      'ERROR', c_error
    )
  );
end;
$$;
