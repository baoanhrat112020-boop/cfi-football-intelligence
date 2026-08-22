# CFI Audit Commands — Standard Contract

## Purpose
Standardize performance-audit commands for immutable CFI pre-match predictions. These commands must never reconstruct or alter predictions after actual results are known.

## Canonical commands

### `CFI AUDIT YYYY-MM-DD`
Audit one target date.

Required behavior:
1. Call `cfiGetPredictionHistory` for the requested `target_date`.
2. Preserve immutable prediction snapshots as the only prediction source.
3. Call `cfiCollectResults` for unresolved snapshots that should already have finished.
4. Call `cfiGetResults` after collection/settlement.
5. Never reconstruct, revise, or backfill prediction values after actual results are known.
6. Keep unresolved matches as `PENDING` with an explicit reason.
7. Exclude synthetic/test fixtures from performance metrics (for example `CFI E2E ...`, `NONEXISTENT ...`).

## Canonical primary output format
All audit commands (`YYYY-MM-DD`, `TODAY`, `LAST`, `3D`, `7D`, `RANGE`) MUST render the primary match ledger first as one compact row per match with exactly these columns and this order:

| Trận | HT | FT | 3+ HT | 7+ FT | Other HT | Other FT | Top3 HT | Top3 FT |
|---|---:|---:|---|---|---|---|---|---|

Rendering rules:
- One match = exactly one table row; do not split a match across multiple rows.
- `HT` and `FT` are verified actual scorelines for SETTLED matches.
- Four threshold columns display `HIT` or `MISS` for SETTLED matches.
- `Top3 HT` and `Top3 FT` display `HIT` or `MISS` using HIT@3.
- For unresolved matches, unavailable actual/outcome cells display `PENDING`, never fabricated values.
- Keep the primary table compact and mobile-readable. Do not put probabilities, Brier, Method A/B/FINAL values, long reasons, hashes, IDs, or engineering telemetry inside this primary table.
- Detailed probabilities, Method A vs Method B vs FINAL, Brier/log-loss/calibration, pending reasons and engineering diagnostics belong below the primary table in secondary sections.

Required secondary details when available:
- Prediction created_at
- Settlement status
- FINAL probabilities for 3+ HT, 7+ FT, Other HT, Other FT
- Top-3 predicted scoreline lists
- Most likely HT→FT path
- Mean Brier when settled

Required summary:
- Total selected real predictions
- SETTLED / PENDING
- Actual occurrence rate for each threshold market
- Top-3 HT accuracy
- Top-3 FT accuracy
- Mean Brier
- Method A vs Method B vs FINAL when fields are available
- Best/worst performing target based on available settled evidence

### `CFI AUDIT 3D`
Canonical implementation endpoint: `GET /api/audit-3d` (`cfiAudit3D`).

Hard semantics:
- `3D` means the **latest three DISTINCT `target_date` values containing real immutable selected prediction snapshots**.
- It NEVER means latest 3 rows/snapshots.
- It NEVER means blindly today/yesterday/day-before-yesterday.
- Return ALL real selected snapshots on those three dates.
- Exclude synthetic/test fixtures before choosing dates and before calculating metrics.
- Auto-collect unresolved snapshots in scope, then return post-collection evaluation rows.

The response must expose:
- `scopeSemantics = LATEST_3_DISTINCT_PREDICTION_DATES`
- resolved `dates[]`
- complete row count in scope
- SETTLED / PENDING
- `syntheticExcluded = true`
- per-day summaries
- full detailed ledger
- anti-leakage flag

### `CFI AUDIT 7D`
Same conceptual contract as `CFI AUDIT 3D`, but use the latest seven distinct target dates containing real snapshots.

### `CFI AUDIT RANGE YYYY-MM-DD YYYY-MM-DD`
Audit all real immutable selected prediction snapshots with target dates inside the inclusive range.

## Hard anti-leakage rules
- Prediction source = immutable pre-match snapshot only.
- Actual results must not modify prediction probabilities, Top-3 lists, ranking, path, or verdict.
- No reconstruction from current engine output.
- No snapshot replay as a substitute for missing historical snapshots.
- No fabricated result or fabricated prediction.
- If actual HT/FT cannot be confidently verified, status remains `PENDING`.
- Synthetic fixtures may be retained for engineering tests but are excluded from production performance audit.

## Interpretation rules
A market outcome (`HIT`/`MISS` in settlement) describes whether the event occurred in reality. It is not by itself a claim that the system made a profitable bet. Performance evaluation must primarily use probability metrics (Brier/log-loss/calibration where available) and Top-3 accuracy.

## Short aliases
- `CFI AUDIT TODAY` = target date corresponding to the user's local current date, only if snapshots exist; otherwise report no snapshots rather than substituting another date.
- `CFI AUDIT LAST` = most recent target date containing real immutable prediction snapshots.
- `CFI AUDIT 3D` = latest 3 distinct target dates containing real snapshots.
- `CFI AUDIT 7D` = latest 7 distinct target dates containing real snapshots.

## Final-status contract
Every audit response must end with exactly one overall state:
- `AUDIT_COMPLETE` — all selected real snapshots in scope settled.
- `AUDIT_PARTIAL` — at least one selected real snapshot remains pending.
- `AUDIT_EMPTY` — no real immutable prediction snapshots exist for the requested scope.
- `AUDIT_ERROR` — the audit pipeline itself failed.
