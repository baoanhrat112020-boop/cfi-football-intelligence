ALTER TABLE match_odds
  ADD COLUMN odds_over_open numeric,
  ADD COLUMN odds_under_open numeric,
  ADD COLUMN odds_home_open numeric,
  ADD COLUMN odds_draw_open numeric,
  ADD COLUMN odds_away_open numeric;
