CREATE TABLE IF NOT EXISTS team_tendency (
  team_id TEXT NOT NULL,
  market TEXT NOT NULL,
  n_matches INT NOT NULL,
  n_events INT NOT NULL,
  rate FLOAT NOT NULL,
  base_rate FLOAT NOT NULL,
  lift FLOAT NOT NULL,
  flag TEXT NOT NULL CHECK (flag IN ('LOW','MEDIUM','HIGH')),
  window_start DATE,
  window_end DATE,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (team_id, market)
);
CREATE INDEX IF NOT EXISTS idx_tt_market_flag ON team_tendency(market, flag);
CREATE INDEX IF NOT EXISTS idx_tt_team ON team_tendency(team_id);