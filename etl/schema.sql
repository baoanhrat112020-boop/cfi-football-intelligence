-- CFI ETL local schema (mirror of Supabase source-of-truth)

CREATE TABLE IF NOT EXISTS _sync_cursor (
  table_name TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_id TEXT,
  row_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS _pipeline_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT,
  phase TEXT,
  level TEXT,
  message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_created ON _pipeline_events(created_at);

-- teams: team_id, canonical_name, normalized_name, created_at
CREATE TABLE IF NOT EXISTS teams (
  team_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT,
  created_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_teams_normalized ON teams(normalized_name);
CREATE INDEX IF NOT EXISTS idx_teams_created ON teams(created_at);

-- team_aliases: alias_normalized, alias_display, team_id, source, confidence, created_at, updated_at
CREATE TABLE IF NOT EXISTS team_aliases (
  alias_normalized TEXT PRIMARY KEY,
  alias_display TEXT,
  team_id TEXT NOT NULL,
  source TEXT,
  confidence NUMERIC,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_team_aliases_team ON team_aliases(team_id);
CREATE INDEX IF NOT EXISTS idx_team_aliases_updated ON team_aliases(updated_at);

-- teams_elo: team_id, rating, matches, updated_at
CREATE TABLE IF NOT EXISTS teams_elo (
  team_id TEXT PRIMARY KEY,
  rating NUMERIC,
  matches INT,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_teams_elo_updated ON teams_elo(updated_at);
-- tier_c_log: Tier C predictions
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
  settled_at TIMESTAMPTZ,
  p_o05_ht FLOAT, p_o15_ht FLOAT, p_btts_h1 FLOAT,
  p_o35_ft FLOAT, p_o45_ft FLOAT, p_o55_ft FLOAT,
  p_2_3_ft FLOAT, p_4_6_ft FLOAT,
  actual_ht_home INT, actual_ht_away INT
);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_match ON tier_c_log(match_id);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_predicted ON tier_c_log(predicted_at);
CREATE INDEX IF NOT EXISTS idx_tier_c_log_unsettled ON tier_c_log(match_id) WHERE actual_home IS NULL;
-- fixtures: canonical matches (source of truth for settle)
CREATE TABLE IF NOT EXISTS fixtures (
  fixture_id TEXT PRIMARY KEY,
  match_date DATE,
  home_team_id TEXT,
  away_team_id TEXT,
  ht_home INT,
  ht_away INT,
  ft_home INT,
  ft_away INT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  competition_key TEXT,
  competition_name TEXT,
  country TEXT,
  season TEXT,
  competition_segment TEXT,
  tier TEXT,
  kickoff_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_fixtures_teams_date ON fixtures(home_team_id, away_team_id, match_date);
CREATE INDEX IF NOT EXISTS idx_fixtures_updated ON fixtures(updated_at);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status);
-- cfi_living_verified_fixtures: staging for verification
CREATE TABLE IF NOT EXISTS cfi_living_verified_fixtures (
  fixture_id TEXT PRIMARY KEY,
  target_date DATE,
  kickoff_at TIMESTAMPTZ,
  home_team TEXT,
  away_team TEXT,
  home_team_norm TEXT,
  away_team_norm TEXT,
  competition TEXT,
  verification_status TEXT,
  source_name TEXT,
  source_url TEXT,
  source_provenance TEXT,
  verified_at TIMESTAMPTZ,
  canonical_home_team_id TEXT,
  canonical_away_team_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_clvf_date ON cfi_living_verified_fixtures(target_date);
CREATE INDEX IF NOT EXISTS idx_clvf_canonical_home ON cfi_living_verified_fixtures(canonical_home_team_id);
CREATE INDEX IF NOT EXISTS idx_clvf_canonical_away ON cfi_living_verified_fixtures(canonical_away_team_id);
-- tier_c_summary_daily: aggregated metrics per day/market
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