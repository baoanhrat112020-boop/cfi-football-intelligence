create table if not exists public.cfi_scheduler_tokens (
  token_name text primary key,
  token text not null check (length(token) >= 32),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

alter table public.cfi_scheduler_tokens enable row level security;
revoke all on table public.cfi_scheduler_tokens from public, anon, authenticated;
grant select on table public.cfi_scheduler_tokens to service_role;

insert into public.cfi_scheduler_tokens(token_name, token)
values ('segment_calibration', encode(gen_random_bytes(32), 'hex'))
on conflict (token_name) do nothing;

do $$
declare
  old_command text;
  new_command text;
begin
  select command into old_command
  from cron.job
  where jobname = 'cfi-segment-calibration-hourly';

  if old_command is null then
    raise exception 'segment calibration cron job not found';
  end if;

  if old_command not ilike '%x-cfi-scheduler-token%' then
    new_command := replace(
      old_command,
      E'\n  ),\n  body :=',
      E'\n  ) || jsonb_build_object(\n    ''x-cfi-scheduler-token'', (select token from public.cfi_scheduler_tokens where token_name = ''segment_calibration'')\n  ),\n  body :='
    );
    perform cron.unschedule('cfi-segment-calibration-hourly');
    perform cron.schedule('cfi-segment-calibration-hourly', '23 * * * *', new_command);
  end if;
end $$;
