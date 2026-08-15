# CFI v3.1 — Contextual Trend + Live Red-Card Intelligence

## Goal
Augment the existing dual-strategy prediction engine with compact team score-trend patterns and match context while preserving uncertainty and frozen market definitions.

## Team trend
For each team, build a compact recent-score fingerprint from strict-prior completed fixtures only. Store/display a small ranked set of weighted FT score patterns (for example `2-1`, `3-1`, `1-1`) instead of bloating canonical fixture rows. Trend data is derived from canonical fixtures and user-ingested canonical screenshots, so the Persistent DB remains the single source of truth.

## Context factors
Context modifies but never replaces the core model. Inputs may include:
- recent score trend / goal environment;
- home or away venue form;
- lineup strength when verified;
- league/table position when available;
- a small explicit random-shock allowance.

Default contextual composition before market scaling:
- trend: 42%
- venue: 26%
- verified lineup strength: 17%
- table position: 10%
- neutral residual anchor: 5%

These are initial engineering weights, not claims of universal optimality. They must be recalibrated by strict-prior walk-forward backtesting as the database grows. Context adjustments are deliberately capped by market-specific scales so a weak contextual signal cannot overwhelm the two primary probability models.

## Random/unexpected component
Football has irreducible variance. CFI therefore carries an explicit small `randomShockWeight` (initial default 2.5 percentage points) and widens the uncertainty band rather than pretending deterministic certainty.

## Live red-card alert
When a user reports a red card, CFI should immediately query/derive two historical cohorts where data exists:
1. the reduced team in prior matches after receiving a red card: post-card goals for/against and collapse frequency;
2. the current opponent in prior matches facing a reduced side: post-card scoring and aggressive-surge frequency.

The live engine combines collapse history, opponent surge history and remaining match time. If the resulting escalation score crosses the alert threshold, CFI emits a **LIVE RED-CARD ESCALATION ALERT** and shows directional boosts for the four frozen markets.

A red card is not automatically a bet signal. Small samples, score state, match minute and missing historical red-card evidence must lower confidence. Alerts must show evidence counts and uncertainty.

## Prediction contract
Each market continues to expose two primary model options:
- A — Empirical Bayes historical model;
- B — Structural Poisson model.

The calibrated CFI result may then receive a bounded contextual adjustment. Final output should expose:
- A probability;
- B probability;
- calibrated/selected base;
- context delta;
- final probability + uncertainty band;
- key factors;
- live red-card alert when applicable.

## Leakage safety
All features used for a target match must be known strictly before the prediction timestamp. Target outcomes and future rows are excluded from trend, form, standings snapshot, lineup calibration and red-card history.
