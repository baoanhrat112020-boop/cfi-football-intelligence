-- CFI security hardening V1
-- Migration-ready only. Apply through the reviewed Supabase migration path, never ad hoc.
-- Goal: internal CFI SECURITY DEFINER RPCs/views remain available to service_role-backed
-- Edge Functions while direct anon/authenticated Data API access is removed.

begin;

-- SECURITY DEFINER functions receive EXECUTE from PUBLIC by default unless explicitly revoked.
-- CFI's privileged database RPCs are internal server seams, so remove browser/user roles.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (p.proname like 'cfi\_%' escape '\' or p.proname = 'rls_auto_enable')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end
$$;

-- These externally flagged audit/research views currently execute with owner privileges.
-- security_invoker ensures underlying RLS/permissions are evaluated as the querying role.
alter view if exists public.cfi_v3_3_replay_source set (security_invoker = true);
alter view if exists public.cfi_prediction_history set (security_invoker = true);
alter view if exists public.cfi_prediction_evaluation set (security_invoker = true);
alter view if exists public.cfi_selected_prediction_audit_summary set (security_invoker = true);
alter view if exists public.cfi_v3_3_scoreboard set (security_invoker = true);
alter view if exists public.cfi_prediction_audit_summary set (security_invoker = true);

revoke all on table public.cfi_v3_3_replay_source from anon, authenticated;
revoke all on table public.cfi_prediction_history from anon, authenticated;
revoke all on table public.cfi_prediction_evaluation from anon, authenticated;
revoke all on table public.cfi_selected_prediction_audit_summary from anon, authenticated;
revoke all on table public.cfi_v3_3_scoreboard from anon, authenticated;
revoke all on table public.cfi_prediction_audit_summary from anon, authenticated;

grant select on table public.cfi_v3_3_replay_source to service_role;
grant select on table public.cfi_prediction_history to service_role;
grant select on table public.cfi_prediction_evaluation to service_role;
grant select on table public.cfi_selected_prediction_audit_summary to service_role;
grant select on table public.cfi_v3_3_scoreboard to service_role;
grant select on table public.cfi_prediction_audit_summary to service_role;

commit;
