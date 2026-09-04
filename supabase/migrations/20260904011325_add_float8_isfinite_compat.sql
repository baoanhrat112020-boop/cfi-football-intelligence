create or replace function public.isfinite(p double precision)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p <> 'NaN'::double precision
     and p <> 'Infinity'::double precision
     and p <> '-Infinity'::double precision
$$;

comment on function public.isfinite(double precision) is
'CFI compatibility overload: PostgreSQL lacks pg_catalog.isfinite(float8); used by immutable multimarket metric functions.';
