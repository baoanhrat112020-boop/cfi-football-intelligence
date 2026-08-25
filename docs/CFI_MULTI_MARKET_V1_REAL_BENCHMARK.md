# CFI Multi-Market V1 — Real Strict-Prior Benchmark

## Status
`BLOCKED_FOR_PROMOTION` — the shadow layer is useful, but current real-data evidence does not justify `decisionUse=true`.

## Corpus
- Source: production Supabase canonical `public.fixtures`.
- Total canonical fixtures observed: 74,871.
- Date coverage: 2005-09-23 through 2026-08-22.
- Complete HT: 74,870.
- Complete FT: 74,871.
- Evaluation target window: 2026-01-01 through 2026-08-21 inclusive.
- Target fixtures in window: 4,798.
- Strict-prior eligible fixtures with usable prior HT/FT team history: 4,263.
- Predictor history: last 10 prior completed fixtures per team; every lookup enforces `fixture.match_date < target.match_date`.
- Score model: independent Poisson generated from pre-match rolling GF/GA lambdas only.

## Real-data Brier results
Lower is better.

| Market | Multi-Market V1 | Base-rate | Result |
|---|---:|---:|---|
| FT Home win | 0.237055 | 0.246711 | PASS vs base |
| FT Draw | 0.187142 | 0.187997 | small PASS vs base |
| FT Away win | 0.207611 | 0.212502 | PASS vs base |
| FT O2.5 | 0.249541 | 0.247102 | FAIL vs base |
| HT Home win | 0.223473 | 0.223459 | essentially tie / slight FAIL |
| HT Draw | 0.242991 | 0.241737 | FAIL vs base |
| HT Away win | 0.191950 | 0.189391 | FAIL vs base |
| HT O1.5 | 0.238325 | 0.233566 | FAIL vs base |

Additional log loss:
- FT 1X2: 1.049551
- FT O2.5: 0.694660

## Calibration findings
### FT Home win
The model carries ranking information but is systematically under-confident through most central probability bins. Examples:
- predicted 0.3499 -> observed 0.4133 (n=1,246)
- predicted 0.4436 -> observed 0.5127 (n=1,024)
- predicted 0.5424 -> observed 0.6077 (n=469)
- predicted 0.6420 -> observed 0.7532 (n=158)

The very high bins are sparse and unstable, so they must not be used for calibration decisions without more data.

### FT O2.5
Calibration is acceptable near the centre but weak in the tails. Examples:
- predicted 0.4522 -> observed 0.5239 (n=1,298)
- predicted 0.5478 -> observed 0.5550 (n=1,400)
- predicted 0.8403 -> observed 0.7222 (n=90)
- predicted 0.9200 -> observed 0.5714 (n=21)

This is consistent with the Brier failure versus base-rate and blocks promotion of O/U from V1.

### HT O1.5
The model is under-confident in low bins and over-confident in upper bins. Examples:
- predicted 0.2511 -> observed 0.3413 (n=1,046)
- predicted 0.3447 -> observed 0.3618 (n=1,661)
- predicted 0.5376 -> observed 0.4395 (n=248)

This indicates that HT needs a separate calibrated structure rather than inheriting the same simple rolling-lambda formulation.

## Decision
1. Keep all new markets `SHADOW_RESEARCH` and `decisionUse=false`.
2. Do not promote O/U or HT markets from this V1 formulation.
3. Preserve FT 1X2 as a promising challenger because all three outcome components improve Brier versus base-rate.
4. Do not promote FT 1X2 yet: calibration is biased and the evaluation window must remain held-out from any calibration fitting.
5. Next experiment must fit calibration using an earlier training period (for example 2025 or earlier) and evaluate it only on the untouched 2026 holdout.
6. Quarter-line AH/O-U remains prediction-only shadow until a dedicated multi-outcome scoring contract is validated.
7. No change is allowed to the frozen six-target Champion contract from these findings.

## Next gate
`TRAIN_CALIBRATION_ON_PAST -> EVALUATE_ON_2026_HOLDOUT -> SEGMENT_REGRESSION -> LOCKED_LIVE_SHADOW`

Promotion remains blocked unless out-of-sample Brier/log-loss/calibration improve without damaging cross-market consistency or the existing Champion behavior.
