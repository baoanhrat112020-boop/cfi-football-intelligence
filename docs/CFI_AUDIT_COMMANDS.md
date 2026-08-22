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

Required output per match:
- Home vs Away
- Prediction created_at
- Settlement status
- Actual HT
- Actual FT
- 3+ HT FINAL probability + actual outcome
- 7+ FT FINAL probability + actual outcome
- Other HT FINAL probability + actual outcome
- Other FT FINAL probability + actual outcome
- Top-3 HT + HIT@3
- Top-3 FT + HIT@3
- Most likely HT→FT path
- Mean Brier when settled

Required summary:
- Total selected predictions
- SETTLED / PENDING
- Actual occurrence rate for each threshold market
- Top-3 HT accuracy
- Top-3 FT accuracy
- Mean Brier
- Method A vs Method B vs FINAL when fields are available
- Best/worst performing target based on available settled evidence

### `CFI AUDIT 3D`
Audit the latest three target dates that contain immutable prediction snapshots.

Important: `3D` means the three most recent prediction dates, not blindly today/yesterday/day-before-yesterday.

For each resolved date, execute the same workflow as `CFI AUDIT YYYY-MM-DD`, then return:
- detailed match ledger
- daily summary
- combined 3-date summary
- remaining PENDING list and reasons

### `CFI AUDIT 7D`
Same contract as `CFI AUDIT 3D`, but use the latest seven target dates containing prediction snapshots.

### `CFI AUDIT RANGE YYYY-MM-DD YYYY-MM-DD`
Audit all immutable prediction snapshots with target dates inside the inclusive range.

## Hard anti-leakage rules
- Prediction source = immutable pre-match snapshot only.
- Actual results must not modify prediction probabilities, Top-3 lists, ranking, path, or verdict.
- No reconstruction from current engine output.
- No snapshot replay as a substitute for missing historical snapshots.
- No fabricated result or fabricated prediction.
- If actual HT/FT cannot be confidently verified, status remains `PENDING`.

## Interpretation rules
A market outcome (`HIT`/`MISS` in settlement) describes whether the event occurred in reality. It is not by itself a claim that the system made a profitable bet. Performance evaluation must primarily use probability metrics (Brier/log-loss/calibration where available) and Top-3 accuracy.

## Short aliases
- `CFI AUDIT TODAY` = target date corresponding to the user's local current date, only if snapshots exist; otherwise report no snapshots rather than substituting another date.
- `CFI AUDIT LAST` = most recent target date containing immutable prediction snapshots.
- `CFI AUDIT 3D` = latest 3 target dates containing snapshots.
- `CFI AUDIT 7D` = latest 7 target dates containing snapshots.

## Final-status contract
Every audit response must end with exactly one overall state:
- `AUDIT_COMPLETE` — all selected snapshots in scope settled.
- `AUDIT_PARTIAL` — at least one selected snapshot remains pending.
- `AUDIT_EMPTY` — no immutable prediction snapshots exist for the requested scope.
- `AUDIT_ERROR` — the audit pipeline itself failed.
