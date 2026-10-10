CREATE TABLE match_odds (
  verified_fixture_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'bongdawap',
  market_family text NOT NULL,
  period text NOT NULL,
  line numeric,
  odds_over numeric,
  odds_under numeric,
  odds_home numeric,
  odds_draw numeric,
  odds_away numeric,
  p_implied_over numeric,
  raw_line text,
  handicap_side text,
  league text,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  n_fetches int DEFAULT 1
);

CREATE UNIQUE INDEX match_odds_uq
  ON match_odds (verified_fixture_id, source, market_family, period, line)
  NULLS NOT DISTINCT;
CREATE INDEX ON match_odds (verified_fixture_id);
CREATE INDEX ON match_odds (last_seen_at);

ALTER TABLE match_odds ENABLE ROW LEVEL SECURITY;
