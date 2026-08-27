# CFI P0-P3 implementation

- P0: final calibrated HT/FT score grids are the single probability core for Champion and Multi-Market; immutable prediction snapshots therefore contain `CFI_MULTI_MARKET_V1` before presentation wrappers run.
- P1: `CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1` evaluates R0 / Future Six / F5 / F10P under one Multi-Market contract; runtime recovery resumes stalled chunks from `next_offset` at reduced chunk size.
- P2: `CFI_MULTI_MARKET_SETTLEMENT_V2` evaluates only immutable snapshots that already contain Multi-Market output; legacy snapshots are skipped rather than reconstructed.
- P3: historical backfill self-seeds 44 verified Football-Data sources (EC, SC1, SC2, SC3 × 2015-16..2025-26) and reuses the existing backfill cron instead of creating a duplicate scheduler.

All challenger and added markets remain research/shadow with `decisionUse=false` until promotion evidence passes the full Multi-Market contract.
