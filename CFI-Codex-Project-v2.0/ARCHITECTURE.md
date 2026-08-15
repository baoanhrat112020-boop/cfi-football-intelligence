# Architecture

## Data path
Public/approved CSV source -> Edge fetch/parser -> validation -> batch RPC -> existing canonical `cfi_upsert_fixture` -> teams/fixtures/quarantine -> CFI read actions.

## Existing components
1. Custom GPT CFI: orchestration, screenshot extraction, descriptive analysis.
2. Supabase Edge Functions: API/import boundary.
3. PostgreSQL/Supabase: canonical persistence and conflict quarantine.
4. CSV importer: converts supported source columns into canonical fixture payloads.

## Current CSV schema support
Required columns: `Date`, `HomeTeam`, `AwayTeam`, `FTHG`, `FTAG`, `HTHG`, `HTAG`.
Date input currently supports DD/MM/YY and DD/MM/YYYY.

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
