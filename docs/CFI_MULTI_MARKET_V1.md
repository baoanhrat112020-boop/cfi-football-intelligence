# CFI Multi-Market Engine V1

## Status
`SHADOW_RESEARCH` — additive only. The frozen six-target production contract remains authoritative.

## Objective
Extend CFI from six primary targets into a coherent multi-market probability system without changing the existing definitions of 3+ HT, 7+ FT, Other HT, Other FT, Top-3 HT, or Top-3 FT.

## New market families

### 1X2
- HT: Home / Draw / Away
- FT: Home / Draw / Away

### Over/Under
- HT ladder: 0.5 through 4.5, including whole lines for push-aware settlement.
- FT ladder: 1.5 through 7.5, including whole lines for push-aware settlement.

### Asian Handicap
- HT and FT
- Home and Away
- Lines from -2.00 through +2.00 in 0.25 increments.
- Quarter-line settlement is represented explicitly as full win / half win / push / half loss / full loss.

## V1 model
V1 derives a normalized independent-Poisson score grid from the existing CFI expected-goal telemetry. It is intentionally a shadow model rather than a replacement for the current final score distribution.

This separation is temporary and deliberate: it lets CFI collect strict-prior out-of-sample evidence before any promotion into the Champion prediction path.

## CFI Output V2
Prematch responses expose an additive `outputV2` decision layer designed for fast human reading without mutating Champion probabilities.

The output contains:
- one headline market;
- Champion market cards with model probability and fair decimal odds;
- optional bookmaker odds and model edge;
- `BET`, `WATCH`, or `PASS` status for Champion markets;
- scoreline Top-3 HT/FT and most-likely HT→FT path;
- expected-goal telemetry and uncertainty/consistency/strict-prior quality gates;
- multi-market 1X2 research cards displayed as `SHADOW` until promotion.

Decision policy:
- no bookmaker odds => never label a market `BET`;
- `BET` requires model edge >= 5 percentage points and acceptable confidence;
- `WATCH` may be used for smaller positive edge or high probability without market odds;
- negative edge is `PASS` regardless of payout size;
- all research markets remain `SHADOW` while `decisionUse=false`;
- output explicitly states that no outcome is guaranteed.

## Invariants
- Existing six-target outputs remain unchanged.
- Existing strict-prior rules remain mandatory.
- No future or same-date evidence may be introduced.
- No prediction-history reconstruction.
- No market is promoted because of a small winning streak.
- 1X2 probabilities must sum to 1.
- O/U over probability must be monotone as the half-goal threshold increases.
- Home -0.5 Asian Handicap must reconcile with Home Win probability; equivalent HT rule also applies.
- Every AH/O-U settlement distribution must sum to 1.

## Promotion gate
Before `decisionUse=true`, the new market layer must demonstrate:
1. strict-prior walk-forward evaluation;
2. sufficient sample size by market and competition segment;
3. Brier/log-loss improvement versus simple baselines where applicable;
4. acceptable calibration;
5. no cross-market consistency violations;
6. no material regression to the frozen six-target production contract;
7. explicit Champion/Challenger promotion approval.

## Real 2026 holdout benchmark
On 4,263 eligible strict-prior fixtures, FT 1X2 components beat simple base-rate Brier baselines, while FT O2.5 and tested HT markets did not. The multi-market layer therefore remains promotion-blocked pending calibration trained only on <=2025 data and segment regression analysis.

## Future integration
After passing the promotion gate, CFI should migrate toward one shared joint score distribution so 1X2, AH, O/U, scorelines, and extreme-tail markets are all integrals of the same probability object.
