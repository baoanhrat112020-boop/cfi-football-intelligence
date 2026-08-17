# Architecture

## Data path
Public/approved CSV source -> Edge fetch/parser -> validation -> batch RPC -> existing canonical `cfi_upsert_fixture` -> teams/fixtures/quarantine -> CFI read actions.

## Existing components
1. Custom GPT CFI: orchestration, screenshot extraction, descriptive analysis.
2. Supabase Edge Functions: API/import boundary.
3. PostgreSQL/Supabase: canonical persistence and conflict quarantine.
4. CSV importer: converts supported source columns into canonical fixture payloads.
5. Prediction/calibration layer: strict-prior Method A/B replay, immutable prediction snapshots, result settlement, challenger-only learning until promotion gates pass.

## Current CSV schema support
Required columns: `Date`, `HomeTeam`, `AwayTeam`, `FTHG`, `FTAG`, `HTHG`, `HTAG`.
Date input currently supports DD/MM/YY and DD/MM/YYYY.

## Transactional Persistent Learning control plane
Persistent learning is not a direct `learn -> write` path. Every candidate mutation must follow:

`PROPOSE -> VERIFY -> COMMIT | REJECT | QUARANTINE | DEFER`

Only `COMMIT` may become authoritative state. The deterministic learning gate checks:

- exact `entity_scope` (team IDs, competition, season, gender, age/reserve level);
- evidence verification and weakest-source trust;
- predecessor/version authority;
- freshness and duplicate uniqueness;
- settled-outcome verification for prediction-derived learning.

Community posts, model outputs, screenshots, and other unverified external content are never authoritative by themselves. Consolidation/summarization cannot raise trust above the weakest source.

### Dependency rollback
Derived artifacts must preserve dependency IDs across:

`fixture/evidence -> Team DNA -> Match DNA -> prediction -> learning record`

If upstream evidence is later invalidated, only affected descendants are marked `INVALIDATED/STALE` and recomputed. Unaffected branches remain active. Historical prediction snapshots and audit evidence remain immutable.

## v2.0B target
Add a bulk orchestrator that consumes a version-controlled manifest of source URLs and imports multiple leagues/seasons without manual URL entry.

Required properties:
- idempotent
- resumable
- bounded concurrency
- per-source counters and failures
- provenance preserved
- no secret leakage
- no modification to canonical contract
- transactional learning decisions are deterministic and reversible
- external/community evidence is quarantined until independently verified
