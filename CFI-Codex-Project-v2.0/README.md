# CFI — Codex Engineering Repository

CFI is a football evidence system with a Persistent Database, screenshot ingestion, CSV ingestion, canonical deduplication, and four frozen descriptive markets.

## Current verified state
- v1.4 Persistent Database: PASS
- v1.5 Persistent Intelligence: PASS
- v1.6 Database Growth & Evidence Engine: PASS
- v2.0A Batch CSV Importer: PASS
- Verified CSV test: Football-Data E0 2025/26, 380 rows
- First run: 380 NEW, 0 ERROR
- Second identical run: 0 NEW, 380 DUPLICATE_COMPATIBLE, 0 ERROR

## Repository layout
- `supabase/functions/cfi-csv-import/index.ts` — current batch CSV Edge Function
- `supabase/sql/cfi_upsert_fixtures_batch.sql` — batch RPC wrapper
- `docs/CFI-KNOWLEDGE-v1.6.md` — frozen operational contract
- `AGENTS.md` — instructions for Codex
- `CODEX_TASK.md` — next implementation task (v2.0B)
- `ARCHITECTURE.md` — system boundaries
- `ROADMAP.md` — staged development plan
- `config/sources.example.json` — initial manifest shape
- `legacy/` — pre-batch importer snapshot

## Secrets
Never commit real secrets. Runtime expects:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CFI_ACTION_KEY`

## Next milestone
Implement v2.0B Bulk Historical Backfill using a source manifest, safe bounded concurrency, source-level audit results, and resumable/idempotent imports. Do not change frozen canonical semantics.
