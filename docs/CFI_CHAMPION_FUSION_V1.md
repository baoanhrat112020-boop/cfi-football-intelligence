# CFI Multi-Market Champion Fusion V1

Status: `SHADOW_RESEARCH` / `decisionUse=false` until formal promotion.

## Runtime architecture

`INCUMBENT_FINAL + HISTORICAL + FUTURE_SIX (+ RECENT_FORM / DIRECTIONAL_RECONCILIATION when available)`

→ context-adaptive expert weights
→ tempered log-opinion pooling at the score-distribution layer
→ one fused HT distribution + one fused FT distribution
→ derive Champion thresholds, Top-3 scorelines, 1X2, Over/Under and Asian Handicap from the same latent distribution.

This preserves cross-market coherence and avoids selecting contradictory per-market probabilities from unrelated models.

## Safety / evidence policy

- strict-prior provenance is mandatory;
- actual result is never an input to prediction;
- Fusion is attached inside `buildPrediction()` before immutable snapshotting;
- Fusion failures are isolated and cannot mutate incumbent Champion outputs;
- `decisionUse=false` is hard-coded until promotion;
- paired settlement uses immutable Fusion snapshot vs the same actual HT/FT used for incumbent settlement;
- no claim of 100% hit rate or guaranteed win is permitted.

## Active experts

- `INCUMBENT_FINAL`: calibrated production score distribution; safety anchor.
- `HISTORICAL`: empirical strict-prior score distribution.
- `FUTURE_SIX`: tempo/dominance/collapse/volatility/extreme-tail specialist.
- optional recent/directional experts when evidence is available.

Historical V2 challengers `F10P` and `F5` remain candidates until the full Multi-Market historical run and promotion gates complete. `K048` remains a separate joint HT→FT trajectory shadow; `K034` remains a real-market intensity specialist.

## Promotion requirements

Promotion requires all of:

1. full strict-prior Historical Learning V2 comparison on the common corpus;
2. paired prospective immutable settlements;
3. Multi-Market aggregate Brier/log-loss improvement;
4. no material Champion / scoreline / 1X2 / O-U / AH segment regression;
5. cross-market consistency PASS;
6. calibration / uncertainty / abstention review;
7. explicit promotion gate changing `decisionUse` from false only after evidence passes.

## GPT contract

No new Action endpoint or request field is required. Current `/api/predict` and `/api/discover` response schemas allow additive fields. GPT Instructions need the Champion Fusion addendum so the shadow block is shown and never treated as actionable before promotion.
