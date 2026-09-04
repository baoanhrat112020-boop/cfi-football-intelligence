create or replace function public.cfi_enqueue_pc_result_recovery(p_days integer default 4, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_floor date := v_today - greatest(1, least(coalesce(p_days,4),14));
  v_count integer := 0;
begin
  insert into public.cfi_pc_result_recovery_queue(
    snapshot_id,target_date,home_team,away_team,snapshot_created_at,status,next_attempt_at,last_error,updated_at
  )
  select h.snapshot_id,h.target_date,h.home_team,h.away_team,s.created_at,'PENDING',now(),null,now()
  from public.cfi_prediction_history h
  join public.cfi_prediction_snapshots s on s.snapshot_id=h.snapshot_id
  where h.selected_for_match_audit=true
    and h.settlement_status='PENDING'
    and s.strict_prior=true
    and h.target_date >= v_floor
    and h.target_date < v_today
    and not exists (
      select 1 from public.cfi_prediction_terminal_resolutions t
      where t.snapshot_id=h.snapshot_id and t.immutable=true
    )
  order by h.target_date desc,s.created_at asc
  limit greatest(1,least(coalesce(p_limit,100),500))
  on conflict (snapshot_id) do update
    set status = case
      when public.cfi_pc_result_recovery_queue.status='SETTLED' then 'SETTLED'
      when public.cfi_pc_result_recovery_queue.status='CANCELLED' then 'CANCELLED'
      when public.cfi_pc_result_recovery_queue.status='IN_FLIGHT' and public.cfi_pc_result_recovery_queue.lease_expires_at > now() then 'IN_FLIGHT'
      else 'PENDING'
    end,
    next_attempt_at = case
      when public.cfi_pc_result_recovery_queue.status='IN_FLIGHT' and public.cfi_pc_result_recovery_queue.lease_expires_at > now()
        then public.cfi_pc_result_recovery_queue.next_attempt_at
      else least(public.cfi_pc_result_recovery_queue.next_attempt_at,now())
    end,
    updated_at=now();
  get diagnostics v_count = row_count;

  update public.cfi_pc_result_recovery_queue q
     set status='SETTLED',settled_at=coalesce(q.settled_at,now()),updated_at=now(),lease_expires_at=null
    from public.cfi_prediction_history h
   where h.snapshot_id=q.snapshot_id
     and h.settlement_status='SETTLED'
     and q.status <> 'SETTLED';

  update public.cfi_pc_result_recovery_queue q
     set status='CANCELLED',updated_at=now(),lease_expires_at=null,
         last_error='TERMINAL_EXCLUDED:'||t.terminal_status
    from public.cfi_prediction_terminal_resolutions t
   where t.snapshot_id=q.snapshot_id
     and t.immutable=true
     and q.status <> 'SETTLED';

  return jsonb_build_object('status','OK','today',v_today,'floorDate',v_floor,'upserted',v_count);
end;
$function$;

create or replace function public.cfi_claim_pc_result_recovery(p_limit integer default 8, p_lease_minutes integer default 15)
returns table(snapshot_id uuid, target_date date, home_team text, away_team text, snapshot_created_at timestamptz, attempts integer)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  return query
  with due as (
    select q.snapshot_id
    from public.cfi_pc_result_recovery_queue q
    where not exists (
      select 1 from public.cfi_prediction_terminal_resolutions t
      where t.snapshot_id=q.snapshot_id and t.immutable=true
    )
      and (
        (q.status in ('PENDING','RETRY') and q.next_attempt_at <= now())
        or (q.status='IN_FLIGHT' and coalesce(q.lease_expires_at,'epoch'::timestamptz) <= now())
      )
    order by q.target_date desc,q.attempts asc,q.created_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,8),20))
  ), claimed as (
    update public.cfi_pc_result_recovery_queue q
       set status='IN_FLIGHT',
           attempts=q.attempts+1,
           last_pulled_at=now(),
           lease_expires_at=now()+make_interval(mins=>greatest(5,least(coalesce(p_lease_minutes,15),60))),
           updated_at=now()
      from due
     where q.snapshot_id=due.snapshot_id
     returning q.snapshot_id,q.target_date,q.home_team,q.away_team,q.snapshot_created_at,q.attempts
  )
  select * from claimed;
end;
$function$;
