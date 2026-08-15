# CFI v2.0C — Automatic Current-Season Refresh

CFI v2.0C makes the Persistent Database grow automatically from current-season CSV sources without requiring users to paste CSV URLs.

## Runtime path

`Supabase cron -> cfi-current-refresh -> current=true manifest sources -> CSV parser -> cfi_upsert_fixtures_batch -> frozen cfi_upsert_fixture -> Persistent DB`

The refresh endpoint always forces `currentOnly=true`. It accepts only:

```json
{"concurrency":3}
```

For retrying failed current-season sources only:

```json
{"concurrency":3,"sourceIds":["eng-e0-2026-27"]}
```

It returns run metadata, per-source results, aggregate counters, and a checkpoint containing completed and failed source IDs.

## Idempotency

Repeated refreshes are safe. Existing fixtures return `DUPLICATE_COMPATIBLE`; only newly appended completed fixtures become `NEW`. Missing or malformed scores remain rejected and are never converted to zero.

## Deploy

1. Deploy `cfi-current-refresh` with the same `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CFI_ACTION_KEY` secrets already used by CFI.
2. Store two Vault secrets in Supabase: `CFI_CURRENT_REFRESH_URL` and `CFI_ACTION_KEY`.
3. Run `supabase/sql/cfi_current_refresh_cron.sql`.
4. The default schedule refreshes every 6 hours at minute 17.

No prediction, calibration, CP/model, canonical dedup, or conflict-quarantine behavior is changed.
