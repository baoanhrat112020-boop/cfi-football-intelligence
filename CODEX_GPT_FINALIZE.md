# CFI Football Intelligence GPT — FINALIZE MISSION

## Goal
Finish the actual Custom GPT named **CFI Football Intelligence** so it is practical to use from GPTs, not merely a web dashboard or backend demo.

## Scope
Work only toward the GPT production path:

GPT Instructions → GPT Action schema → Cloudflare Worker `/api/predict` → Persistent CFI DB → final user-facing prediction.

Do not spend time redesigning unrelated web UI unless required for the GPT action backend.

## Required behavior
For every pre-match request with HOME/AWAY, call `cfiPredictMatch` and return a complete result in the user's selected language (Vietnamese by default).

The result MUST contain:
1. Match identity, target date and engine version.
2. Strict-prior data coverage for HOME, AWAY and H2H.
3. Team Trending DNA for both teams.
4. Four frozen markets: 3+ HT, 7+ FT, Other HT, Other FT.
5. For EACH market: Method A, Method B, Final CFI probability, confidence/uncertainty, supporting and opposing evidence.
6. HT Scoreline Intelligence: Top 3 exact scores + probabilities.
7. FT Scoreline Intelligence: Top 3 exact scores + probabilities.
8. Most likely HT→FT path and scoreline uncertainty.
9. Material prediction factors actually available: historical DB, Home/Away split, H2H, recent trend, goal timing, standings/opponent strength when available, tactical/style context when available, rest/fatigue when available, lineup/goalkeeper when available, match-state/collapse behavior, red-card/live context when applicable, randomness allowance.
10. Final ranking of the four markets strongest→weakest. `NO STRONG SIGNAL` is allowed but must never suppress probabilities or scoreline forecasts.

## Data correctness
- Strict-prior only: historical match_date < target_date.
- Canonical score fields include `ht_home`, `ht_away`, `ft_home`, `ft_away`; adapters may also accept normalized string/object forms.
- Missing data stays unknown/null, never fabricated as zero.
- Duplicate-compatible evidence must not inflate canonical fixture counts.
- Frozen market definitions must not change.
- If upstream `/predict` returns NOT_FOUND, Persistent DB fallback must compute from HOME history + AWAY history + H2H.
- A fallback is not accepted if HT/FT coverage is zero while canonical score fields exist.

## Model quality
Do not stop at infrastructure PASS. Backtest on historical canonical fixtures using walk-forward/strict-prior simulation. Use the backtest to tune/calibrate only model weights and probability calibration, never frozen market definitions or canonical data semantics.

Method A should represent historical/statistical evidence.
Method B should represent recent/context/Match-DNA evidence.
Final CFI should be calibrated synthesis based on evidence quality, sample size, recency and relevance, not a blind average.

Scoreline forecasts must be internally consistent with market probabilities. Add consistency diagnostics/tests.

## GPT production assets
Keep these production-ready and synchronized:
- `gpt-action/openapi.yaml`
- `gpt-action/CFI_GPT_INSTRUCTIONS.md`
- Cloudflare Worker prediction route used by the GPT
- automated regression/backtest tests

The OpenAPI request field must be `target_date` and the status operation must be `cfiGetStatus`.

## Acceptance gates
Do not declare completion until all are true:
- GPT action schema parses cleanly.
- `/api/status` succeeds.
- `/api/predict` succeeds for a known-data match.
- fallback returns HT/FT coverage > 0 when canonical scores exist.
- each market returns Method A, Method B and Final CFI.
- scoreline returns Top 3 HT and Top 3 FT.
- strict-prior leakage tests pass.
- walk-forward backtest runs without future leakage.
- no fabricated context.
- Vietnamese output contract is complete and readable on mobile GPT.
- regression case `Young Violets Austria Wien vs SV Austria Salzburg`, target `2026-08-15`, no longer produces denominator-zero or lambda-floor artifacts.

## Execution rule
Inspect, implement, test, fix and retest autonomously. Do not stop for intermediate user QA. Do not return a plan as the final result. Return only when the GPT production path is ready, with changed files, tests/backtest summary, final commit/PR, and the exact final Instructions + OpenAPI block the user must paste into Custom GPT if account-level editing cannot be performed programmatically.
