# CFI 70K+ SHADOW LEARNING PLAN

Status: ACTIVE
Incumbent production engine: CFI_FINAL_V5.2.2
Safety mode: SHADOW ONLY
Auto-promotion: DISABLED

## Mission
Use the full Persistent DB corpus to evaluate and improve CFI without changing, reconstructing, or contaminating the current production prediction path.

## Current verified dataset baseline — 2026-08-20
- fixtures: 74,479
- HT complete: 74,478
- FT complete: 74,479
- date range: 2005-09-23 → 2026-08-19
- duplicate canonical identity rows by date/home/away: 0
- competitions: 18
- countries: 11
- competition segments: ELITE_PRO 38,210; MID_PRO 34,691; unclassified 1,578
- immutable production snapshots: 56
- settled snapshots: 29
- selected + settled production snapshots: 23

## Critical finding
The legacy `cfi-calibration-learn` function currently reads fixtures using `.range(0,9999)`, so it cannot use the full 74k+ corpus. Its internal learner is also not guaranteed to be algorithmically identical to the current CFI_FINAL_V5.2.2 prediction engine. It MUST NOT be treated as evidence that the full database has already trained the current engine.

## Phase 0 — Freeze incumbent [DONE]
- Keep CFI_FINAL_V5.2.2 production authoritative.
- No automatic weight replacement.
- No historical prediction mutation.
- No replay result can directly change production.

Exit gate: production path unchanged.

## Phase 1 — Full-corpus data audit [IN PROGRESS]
Tasks:
1. Count exact fixtures / HT / FT coverage.
2. Verify canonical duplicate count.
3. Record date range, competitions, countries and segment coverage.
4. Identify missing cohort metadata.
5. Create immutable dataset fingerprint for every replay run.

Exit gate:
- >=99.9% FT coverage
- duplicate canonical conflicts resolved or quarantined
- source count recorded

## Phase 2 — Scalable strict-prior replay [STARTED]
The replay engine must evaluate each historical match at time T using only matches dated before T.

Required models:
- Method A — Historical Production
- Method B — Future Six
- FINAL CFI

Required six-target evaluation:
- 3+ HT
- 7+ FT
- Other HT
- Other FT
- Top-3 HT
- Top-3 FT

Required metrics:
- Brier by threshold market
- reliability/calibration bins
- threshold prevalence
- Top-1 HT/FT accuracy
- Top-3 HT/FT accuracy
- rank-of-hit
- directional consistency

Implementation status:
- `CFI_DUAL_HISTORICAL_REPLAY_V0.3` removes the old O(N²) global prior scan.
- Date-batched incremental team/H2H indexes preserve `sameDateLeakage=false`.
- FINAL_CFI has been added as a third evaluated model.

Exit gate:
- full 74k corpus can replay without same-day/future leakage
- deterministic replay fingerprint
- all three model branches evaluated

## Phase 3 — Cohort intelligence [PLANNED]
At minimum report GLOBAL + competition_segment:
- ELITE_PRO
- MID_PRO
- UNCLASSIFIED

Then extend where metadata is reliable:
- competition
- country/region
- senior/youth
- men/women
- reserve/amateur
- sample-size bucket
- volatility bucket

Purpose: learn where A/B/FINAL actually perform differently instead of applying one universal weighting rule.

Exit gate: no cohort is used for optimization below minimum sample threshold.

## Phase 4 — Shadow candidate optimizer [PLANNED]
Create candidate parameters independently of production.

Candidate may learn:
- market-specific A/B weights
- cohort-specific reconciliation weights
- calibration maps
- scoreline directional reconciliation strength

Candidate MUST NOT:
- rewrite snapshots
- change CFI_FINAL_V5.2.2
- use target/future result leakage
- learn from unverified settlement as truth

Candidate naming: `CFI_CANDIDATE_V5.3.x`.

## Phase 5 — Promotion gates [PLANNED]
Default decision: HOLD.

Minimum promotion evidence:
1. strict-prior replay passes leakage audit;
2. candidate improves mean Brier out-of-sample;
3. no important market has unacceptable Brier degradation;
4. calibration slope/intercept or reliability error does not regress materially;
5. Top-3 HT/FT accuracy does not materially regress;
6. gains are not isolated to one league/cohort;
7. minimum sample gate is met;
8. selected settled production snapshots provide live confirmation;
9. candidate parameters are versioned and reversible.

Promotion remains guarded/manual until enough evidence supports automation.

## Phase 6 — Daily learning report [PLANNED]
Every completed learning cycle should produce:
- what new fixtures/results arrived;
- what the model learned;
- A vs B vs FINAL performance changes;
- market improved/worsened;
- cohort improved/worsened;
- calibration drift;
- candidate status;
- promotion decision: PROMOTE / HOLD / REJECT;
- explicit reasons.

Example:
`7+ FT Brier improved in MID_PRO; Top-3 HT regressed in ELITE_PRO; candidate remains HOLD.`

## Persistence layer [DONE]
Additive SHADOW tables created in Supabase:
- `cfi_replay_runs`
- `cfi_replay_metrics`
- `cfi_learning_reports`

These tables are research/audit storage only and do not drive production automatically.

## Immediate execution queue
1. Build paginated full-fixture reader (>10k safe).
2. Build replay runner around `CFI_DUAL_HISTORICAL_REPLAY_V0.3`.
3. Add dataset fingerprint/checkpointing so 74k replay can resume.
4. Persist global metrics to `cfi_replay_runs` + `cfi_replay_metrics`.
5. Add ELITE_PRO/MID_PRO cohort pass.
6. Generate first full 74k baseline report for A/B/FINAL.
7. Only after baseline exists, build candidate optimizer.

## Non-negotiable safety invariants
- production engine remains CFI_FINAL_V5.2.2 until an explicit promotion action;
- no replay writes to fixtures;
- no replay mutates prediction history;
- same-date matches are not prior evidence for each other;
- actual result is used only as the label after prediction has been generated;
- missing HT is unknown, never zero;
- all candidate changes are reversible and versioned.
