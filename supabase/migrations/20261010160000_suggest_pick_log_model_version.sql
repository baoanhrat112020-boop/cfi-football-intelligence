ALTER TABLE public.suggest_pick_log ADD COLUMN model_version text;

UPDATE public.suggest_pick_log
SET model_version = CASE
  WHEN last_logged_at < '2026-10-09 08:21:00+00'::timestamptz THEN 'v1_ht045'
  ELSE 'v2_ht050'
END;

ALTER TABLE public.suggest_pick_log ALTER COLUMN model_version SET NOT NULL;
ALTER TABLE public.suggest_pick_log ALTER COLUMN model_version SET DEFAULT 'v2_ht050';
