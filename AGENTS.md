# CFI Codex Agent Contract

## Mission
Develop CFI's data engineering layer without changing the frozen canonical fixture semantics or four-market definitions.

## Frozen behavior
- Existing `cfi_upsert_fixture` is the canonical single-fixture authority.
- Never silently overwrite conflicts; quarantine them.
- Missing scores remain null, never zero.
- Shootout values are not regulation FT goals.
- Future/unplayed fixtures are not historical evidence.
- Exact identity + match date + home + away drive canonical deduplication.
- 3+ HT: total HT >= 3.
- 7+ FT: total FT >= 7.
- Other HT: either team HT >= 4.
- Other FT: either team FT >= 5.
- Database growth must not silently tune prediction weights or calibration.

## Engineering rules
- Preserve idempotency. Reimporting the same source must create zero new canonical fixtures.
- Prefer batch/database operations over per-row network RPC loops.
- Every source must have provenance.
- Do not commit secrets, service-role keys, action keys, or project credentials.
- Add tests for parser, validation, idempotency, malformed rows, partial scores, and source failures.
- For large changes, inspect the repository and write/adjust the plan before implementation.
- Keep changes reviewable and document schema/migration impacts.

## Validation gate
A historical backfill feature is not complete until it demonstrates:
1. first import creates expected NEW records;
2. second identical import returns only compatible duplicates;
3. ERROR=0 for valid supported source data;
4. malformed/incomplete records are rejected rather than fabricated;
5. persistent counters reconcile after import.
