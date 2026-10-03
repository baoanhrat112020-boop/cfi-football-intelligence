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