# CFI Multi-Market Research Contract V1

Status: `RESEARCH_ONLY / R0_IMMUTABLE / NO_AUTO_PRODUCTION`.

## Knowledge Hunt priority
Knowledge Hunt keeps foundational forecasting knowledge but applies a 60% Multi-Market / 40% foundational weighting. New queue candidates must score at least 70 for both applicability and multi-market relevance and have SOURCE_VERIFIED, CROSS_CHECKED, or VERIFIED provenance.

Priority tracks: P1 O/U ladders; P2 Asian Handicap; P3 joint score/coherence; P4 1X2; P5 market price/value; P6 uncertainty/abstention; P7 foundational forecasting.

## Promotion Score V2
Weights: Brier/accuracy 20; calibration 15; ranking 15; coherence 10; temporal OOT 15; segment robustness 10; determinism/swap/diversity 5; decision utility/market comparison 10.

Historical score >=80 is only `SHADOW_ELIGIBLE`. Hard gates override the score. Production eligibility is never granted by this research gate.

## Market price artifacts
`CFI_MARKET_SNAPSHOT_V1` is forward-only and append-only. `captured_at < kickoff_at` is mandatory. Closing snapshots may be retained for post-event evaluation, but cannot be referenced by a prematch decision snapshot.

`CFI_DECISION_SNAPSHOT_V1` is simulated-only: `decision_use=false`; stake is a research unit only; no historical odds reconstruction is permitted.

The corresponding SQL is `supabase/sql/cfi_multimarket_market_snapshots_v1.sql`. Applying it creates only research tables and does not mutate canonical fixtures, teams, historical predictions, or Champion semantics.
