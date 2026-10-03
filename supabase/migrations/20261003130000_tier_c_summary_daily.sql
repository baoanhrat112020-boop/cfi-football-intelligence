CREATE TABLE IF NOT EXISTS tier_c_summary_daily (
  day DATE NOT NULL,
  market TEXT NOT NULL,
  n_total INT NOT NULL,
  n_hit INT NOT NULL,
  hit_rate FLOAT,
  brier FLOAT,
  avg_pred FLOAT,
  actual_rate FLOAT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (day, market)
);
CREATE INDEX IF NOT EXISTS idx_tcsd_day ON tier_c_summary_daily(day);