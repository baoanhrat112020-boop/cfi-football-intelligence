BEGIN;

CREATE TABLE IF NOT EXISTS public.user_ou_observations (
  fixture_id uuid NOT NULL,
  period text NOT NULL CHECK (period IN ('HT','FT')),
  line numeric NOT NULL CHECK (line > 0 AND line < 10 AND (line*4) = round(line*4)),
  odds_over numeric CHECK (odds_over IS NULL OR (odds_over > 1.0 AND odds_over < 20)),
  odds_under numeric CHECK (odds_under IS NULL OR (odds_under > 1.0 AND odds_under < 20)),
  model_chosen_line numeric,
  bookmaker text CHECK (bookmaker IS NULL OR length(bookmaker) <= 30),
  note text CHECK (note IS NULL OR length(note) <= 200),
  updated_at timestamptz DEFAULT NOW(),
  PRIMARY KEY (fixture_id, period)
);

CREATE INDEX IF NOT EXISTS user_ou_observations_updated_at_idx ON public.user_ou_observations (updated_at DESC);

ALTER TABLE public.user_ou_observations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_ou_observations FROM anon, authenticated;

COMMIT;
