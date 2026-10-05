DROP INDEX IF EXISTS public.fixtures_comp_date_idx;
DROP INDEX IF EXISTS public.fixtures_tier_idx;

-- Rollback:
-- CREATE INDEX fixtures_comp_date_idx ON public.fixtures USING btree (competition_key, match_date);
-- CREATE INDEX fixtures_tier_idx ON public.fixtures USING btree (tier);
