# Codex Task — CFI v2.0B Bulk Historical Backfill

## Goal
Implement a production-ready bulk historical CSV backfill layer on top of the already verified v2.0A importer.

## Start in Ask/Plan mode
First inspect all repository files. Produce a concise implementation plan and identify any missing database definitions needed to safely test. Do not invent the body/signature of existing `cfi_upsert_fixture`; treat it as frozen external DB behavior unless its migration is added to the repo by the user.

## Required deliverables
1. Source manifest format supporting season, country, league, source URL, enabled flag, and source/provider metadata.
2. `cfi-bulk-import` Edge Function or equivalent orchestrator.
3. Import one or many manifest entries with bounded concurrency and no unbounded long-running request.
4. Per-source result: fetched rows, accepted rows, NEW, DUPLICATE_COMPATIBLE, COMPLEMENTARY, CONFLICT, REJECTED, ERROR, elapsed time.
5. Overall aggregate counters.
6. Idempotent reruns.
7. Failure isolation: one bad URL/source must not corrupt or erase successful sources.
8. Resume/checkpoint design suitable for historical multi-season backfill.
9. Tests for manifest validation, URL failures, malformed CSV, duplicate reruns, blank score fields, and partial/unplayed rows.
10. Documentation for deploying from Supabase and invoking from an iPhone-friendly workflow.

## Historical scope
Design for approximately four seasons plus current season across multiple leagues. Do not hard-code only Premier League.

## Current verified baseline
URL used for validation:
`https://www.football-data.co.uk/mmz4281/2526/E0.csv`

Verified behavior:
- Run 1: rows=380, NEW=380, ERROR=0.
- Run 2: rows=380, NEW=0, DUPLICATE_COMPATIBLE=380, ERROR=0.

This behavior must remain intact.

## Source/licensing rule
Do not add a source to the default production manifest until its access pattern and permitted reuse have been reviewed. Keep provider metadata/provenance with every imported record.

## Non-goals for v2.0B
- No model retraining.
- No change to CFI market definitions.
- No automatic probability calibration.
- No cross-AI autonomous knowledge exchange.
- No silent canonical conflict resolution.

## Acceptance gate
A representative multi-source test must pass, then an identical rerun must create zero NEW fixtures while returning compatible duplicates for previously imported fixtures. All source failures must be explicit and auditable.
