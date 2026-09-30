CREATE TABLE IF NOT EXISTS tier_c_log (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT,
  predicted_at TIMESTAMPTZ DEFAULT NOW(),
  home_team TEXT,
  away_team TEXT,
  p_home FLOAT, p_draw FLOAT, p_away FLOAT,
  p_over25 FLOAT, p_btts FLOAT,
  xg_home FLOAT, xg_away FLOAT,
  elo_home REAL, elo_away REAL,
  model TEXT,
  actual_home INT, actual_away INT,
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_match ON tier_c_log(match_id);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_predicted ON tier_c_log(predicted_at);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_unsettled ON tier_c_log(match_id) WHERE actual_home IS NULL;
