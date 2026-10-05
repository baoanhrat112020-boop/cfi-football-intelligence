CREATE TABLE public.suggest_pick_log (
  fixture_id          uuid PRIMARY KEY,
  target_date         date        NOT NULL,
  kickoff_at          timestamptz NOT NULL,
  home_team           text        NOT NULL,
  away_team           text        NOT NULL,
  home_team_id        uuid,
  away_team_id        uuid,
  lambda_home_ft      real        NOT NULL,
  lambda_away_ft      real        NOT NULL,
  p_over05_ht         real        NOT NULL,
  p_over075_ht        real        NOT NULL,
  p_over1_ht          real        NOT NULL,
  top_market          text,
  top_market_prob     real,
  pred_home_ht        smallint,
  pred_away_ht        smallint,
  pred_home_ft        smallint,
  pred_away_ft        smallint,
  confidence_tier     text        NOT NULL CHECK (confidence_tier IN ('CAO','KHA','TB','THAP','RAT_THAP')),
  official            boolean GENERATED ALWAYS AS (p_over075_ht >= 0.55) STORED,
  p_over075_ht_first  real        NOT NULL,
  n_updates           smallint    NOT NULL DEFAULT 1,
  first_logged_at     timestamptz NOT NULL DEFAULT now(),
  last_logged_at      timestamptz NOT NULL DEFAULT now(),
  settled_at          timestamptz,
  void_reason         text CHECK (void_reason IN ('NO_RESULT','NO_HT')),
  ht_home             smallint,
  ht_away             smallint,
  ft_home             smallint,
  ft_away             smallint,
  hit_o05_ht          boolean,
  hit_o1_ht           boolean,
  result_o075         text CHECK (result_o075 IN ('WIN','HALF_WIN','LOSS')),
  hit_top_market      boolean
);

CREATE INDEX suggest_pick_log_unsettled_idx ON public.suggest_pick_log (kickoff_at) WHERE settled_at IS NULL;
CREATE INDEX suggest_pick_log_kickoff_idx ON public.suggest_pick_log (kickoff_at);
CREATE INDEX suggest_pick_log_settled_idx ON public.suggest_pick_log (settled_at);

ALTER TABLE public.suggest_pick_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suggest_pick_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.suggest_pick_log TO service_role;
