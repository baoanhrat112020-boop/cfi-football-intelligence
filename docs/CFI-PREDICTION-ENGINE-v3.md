# CFI v3 — Dual-Strategy Prediction Engine

## Goal

For every prediction turn, return **two independent probability paths for each of the four frozen markets** and then select or blend them using strict-prior walk-forward backtesting.

Frozen markets:

- `3+ HT`: total HT goals >= 3
- `7+ FT`: total FT goals >= 7
- `Other HT`: either team HT goals >= 4
- `Other FT`: either team FT goals >= 5

## Option A — EMPIRICAL_BAYES

A recency-weighted historical hit-rate model with Beta shrinkage. It combines HOME history, AWAY history and H2H, giving H2H a modest extra weight while preventing tiny samples from producing extreme probabilities.

## Option B — POISSON_STRUCTURAL

A goal-count model built from recency-weighted HT/FT scoring rates. It estimates market tail probabilities from Poisson distributions. For Other markets it evaluates the probability that either side crosses the team-goal threshold.

## Automatic method selection

The engine performs strict-prior walk-forward backtesting. Each historical row is treated as a pseudo-target; only rows earlier than that target are used for training. Brier score is calculated separately for Option A and Option B for each market.

- Clear lower Brier score -> select that method.
- Similar Brier scores -> inverse-Brier weighted blend.
- Too little history -> conservative 50/50 blend and `INSUFFICIENT`/`PARTIAL` data-quality flag.

This is deliberate model selection, not silent database-driven retuning. Prediction calibration is versioned in code and can be regression-tested.

## Anti-leakage

Target match and any fixture on/after target date are excluded from prediction evidence. Historical backtests use expanding windows only. Future/unplayed rows are not prediction evidence.

## Past-result learning

Past results are used in three controlled ways:

1. estimate empirical market hit rates;
2. estimate structural goal intensities;
3. compare methods through walk-forward Brier score.

Past outcomes never overwrite canonical fixture evidence and never justify perfect-confidence claims.

## Output contract

Each market returns:

- Option A probability
- Option B probability
- selected method (`EMPIRICAL_BAYES`, `POISSON_STRUCTURAL`, or `BLEND`)
- selected probability
- evidence count
- data quality

The UI may show both options side-by-side so the user can see model disagreement rather than receiving a single opaque number.
