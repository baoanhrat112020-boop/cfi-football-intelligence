# CFI — Football Intelligence

CFI v2.0B adds manifest-driven, bounded-concurrency historical CSV backfill while preserving the frozen canonical `cfi_upsert_fixture` contract and the verified v2.0A single-source importer.

## Layout

- `AGENTS.md`, `CODEX_TASK.md`, `ARCHITECTURE.md`, `ROADMAP.md` — project contracts and plan.
- `config/sources.json` — versioned production source manifest covering five seasons across supported leagues.
- `supabase/functions/_shared/cfi-import-core.ts` — shared validation, parsing, counters, batching and failure isolation.
- `supabase/functions/cfi-csv-import/index.ts` — backward-compatible single-URL v2.0A endpoint using the shared core.
- `supabase/functions/cfi-bulk-import/index.ts` — manual and scheduler-ready bulk endpoint.
- `supabase/sql/cfi_upsert_fixture.sql` — supplied frozen production canonical RPC.
- `supabase/sql/cfi_upsert_fixtures_batch.sql` — 500-fixture batch wrapper.
- `tests/` — credential-free regression tests.

## Invoke

Deploy both functions and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CFI_ACTION_KEY` as Supabase secrets. Call `cfi-bulk-import` with `POST`, header `x-cfi-key`, and an optional body such as:

```json
{"filters":{"countries":["England"],"seasons":["2025-26"]},"concurrency":3}
```

For scheduled v2.0C-style refreshes, invoke the same endpoint with `{"filters":{"currentOnly":true}}`. No CSV URL is required. A partial result contains `checkpoint.failedSourceIds`; retry only those IDs with `filters.sourceIds` while completed sources remain safe to rerun because canonical writes are idempotent.

## Deployment order

1. Apply `supabase/sql/cfi_upsert_fixture.sql` only if the production definition is not already identical, then apply `cfi_upsert_fixtures_batch.sql`.
2. Review provider reuse/access terms and the enabled source manifest before production backfill.
3. Deploy `cfi-csv-import` and `cfi-bulk-import`, configure secrets, and invoke a representative filtered run.
4. Confirm counters, then rerun the identical filter and require zero `NEW` with compatible duplicates.

No prediction, market, calibration, conflict-quarantine, or deduplication behavior is changed.
