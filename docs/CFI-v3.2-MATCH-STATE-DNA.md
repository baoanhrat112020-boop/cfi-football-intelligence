# CFI v3.2 — Match State DNA

CFI v3.2 extends v3.1 without changing canonical fixture semantics or the four frozen markets.

## New contextual evidence
1. Goal timing: 1–15, 16–30, 31–45+, late FT.
2. Game-state behavior: behavior when leading and when trailing.
3. Collapse DNA: rapid concessions and historical collapse patterns.
4. Opponent-strength-adjusted form.
5. Rest/fatigue and schedule congestion.
6. Match motivation when verifiable.
7. Style matchup.
8. Goalkeeper and defensive stability.
9. Starting-XI continuity.
10. Live momentum: shots, SOT, big chances, dangerous pressure, corners, xG when available.
11. Scoreline pressure by minute and current score.
12. Referee volatility, low weight only.
13. Extreme weather/pitch, only when materially abnormal.

## Prediction contract
The calibrated dual-model prediction remains the core. Context is market-specific and bounded; it cannot overwhelm the core probability. Missing context contributes zero rather than being guessed. A small random-shock allowance remains in the uncertainty band.

## Anti-leakage
Historical features must be strict-prior to the target kickoff. Live features may use only observations available at the prediction timestamp. Target/future outcomes never enter features or calibration.

## Learning
Walk-forward evaluation should measure each context family's incremental Brier/log-loss value per market. Factors that do not improve out-of-sample calibration should be down-weighted or disabled rather than accumulated indefinitely.

## Live red-card integration
The existing v3.1 red-card engine remains the high-priority event trigger. Match State DNA supplies collapse, opponent-surge, scoreline-pressure and live-momentum context to improve escalation confidence. A red card alone is never treated as a guaranteed betting edge.
