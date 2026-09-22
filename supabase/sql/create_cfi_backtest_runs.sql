-- Idempotent, đã chạy 1 lần qua Supabase MCP khi làm scripts/backtest.ts.
-- Giữ lại đây làm bản ghi/tái tạo nếu cần trên project khác.
CREATE TABLE IF NOT EXISTS cfi_backtest_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  n_fixtures INT NOT NULL,
  n_ok INT NOT NULL,
  n_skip INT NOT NULL,
  brier_3ht NUMERIC, brier_7ft NUMERIC, brier_other_ht NUMERIC, brier_other_ft NUMERIC,
  logloss_3ht NUMERIC, logloss_7ft NUMERIC, logloss_other_ht NUMERIC, logloss_other_ft NUMERIC,
  top1_hit_rate NUMERIC, top3_hit_rate NUMERIC,
  config JSONB
);
