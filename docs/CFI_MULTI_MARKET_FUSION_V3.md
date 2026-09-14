# CFI Multi-Market Fusion V3 — BigDB-aware joint market engine

## Status

- Version: `CFI_MULTI_MARKET_FUSION_V3`
- Mode: `SHADOW_RESEARCH`
- `decisionUse=false`
- `productionEligible=false`
- Baseline/Champion mutation: forbidden
- Promotion: explicit separate approval after locked prospective evidence

## Goal

Improve CFI Multi-Market accuracy without breaking probability coherence or strict-prior integrity.

V3 fuses evidence at the **score-distribution level**, not by independently blending final market probabilities. All derived markets therefore share the same probabilistic source.

## Inputs

V3 can consume the distributions already produced by CFI:

1. `INCUMBENT_FINAL` — calibrated FINAL score distribution.
2. `FUTURE_SIX` — structural challenger distribution.
3. `HISTORICAL` — strict-prior empirical distribution.
4. Optional additional research experts such as recent form or directional reconciliation.
5. `BIGDB_GLOBAL_PRIOR` — global scoreline prior from `cfi-bigdb-retrieval`, admitted only when its temporal audit is strict-prior.

The repository has no component named `BigDT`; this implementation treats that request as the existing CFI BigDB / big-data retrieval layer.

## Core algorithm

### 1. Robust expert fusion

Each period (HT and FT) is fused separately using a normalized logarithmic opinion pool.

Expert weights combine:

- role prior,
- reliability,
- effective sample size,
- disagreement with the weighted centroid.

Large-disagreement experts are automatically penalized. When evidence is thin or disagreement is high, the incumbent distribution receives a minimum stability floor.

### 2. BigDB admission

BigDB is never trusted merely because data exists.

The BigDB scoreline prior is admitted only if all of these are true:

- temporal audit says `verified=true`,
- `maxEvidenceDate < targetDate`,
- `futureEvidenceCount = 0`,
- `sameDateEvidenceCount = 0`,
- both HT and FT scoreline priors are available.

Otherwise BigDB is ignored fail-closed and the reason is surfaced in the audit output.

### 3. Joint HT→FT trajectory projection

Independent HT/FT distributions can imply impossible paths. V3 projects the fused distributions into a joint trajectory where every path satisfies:

- `FT.home >= HT.home`
- `FT.away >= HT.away`

HT mass is preserved and FT is projected onto the feasible trajectory support. Projection total variation is measured; excessive distortion fails the trajectory gate.

### 4. Multi-Market derivation

After trajectory projection, one score-distribution source produces:

- HT 1X2
- FT 1X2
- HT Asian Handicap
- FT Asian Handicap
- HT Over/Under
- FT Over/Under
- 3+ HT
- 7+ FT
- Other HT
- Other FT
- Top-1 HT score
- Top-1 FT score

No market-specific probability blend is allowed to overwrite these derived probabilities.

Required equivalences are audited:

- `3+ HT == HT Over 2.5`
- `7+ FT == FT Over 6.5`

## Final-engine integration

`buildPrediction()` accepts optional `bigDbContext`.

When supplied, the existing incumbent prediction remains unchanged and V3 is exposed as:

`prediction.multiMarketFusionV3`

Failure of V3 is isolated and returns `SHADOW_UNAVAILABLE`; it cannot break the incumbent engine.

## Promotion requirements

`research/multimarket-fusion-v3-promotion-gate.mjs` is fail-closed.

Minimum requirements include:

- strict-prior PASS,
- no reconstruction,
- no prediction-history replay,
- prospective reset,
- locked OOS PASS,
- at least 200 locked OOS rows,
- aggregate Brier improvement of at least 0.001,
- no aggregate log-loss regression,
- no material ECE regression,
- evidence for HT/FT 1X2, O/U, AH and extreme thresholds,
- segment worst Brier delta <= 0.02,
- deterministic PASS,
- directional-swap PASS,
- trajectory PASS,
- cross-market coherence PASS,
- BigDB strict-prior and reproducibility PASS when BigDB is used.

Passing this gate only makes V3 **shadow eligible**. It does not authorize production or `decisionUse=true`.

## Evaluation priority

The intended comparison is not raw hit-rate alone. Rank candidates primarily by:

1. locked OOS aggregate log-loss,
2. locked OOS aggregate Brier,
3. calibration ECE,
4. per-market-group non-regression,
5. segment robustness,
6. trajectory/cross-market coherence,
7. exact-score Top-1 accuracy as a separate diagnostic.

The best model is the one that improves probabilistic quality on unseen data while preserving CFI temporal and settlement integrity.
