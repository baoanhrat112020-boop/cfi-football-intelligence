# CFI Hugging Face Shadow Node V1

Status: `SHADOW_ONLY / RESEARCH_ONLY / NO_PRODUCTION_CONNECTION`.

## Architecture decision

HF is an isolated orchestration/runtime layer around existing CFI research and prediction code. It does not introduce a second forecasting engine.

Reuse map:

- PC-node orchestration principles: run IDs, single-run lock/idempotency, structured logs, fail-closed stages.
- Strict-prior historical replay: `src/learning/dual-historical-replay.ts` through `research/run-r0-bulk.mjs`.
- Multi-Market benchmark: `src/prediction/multi-market-backtest.ts`.
- Multi-Market contract/projection: `research/multi-market-historical-learning-v2.mjs`.
- Production numerical core (read/compute only): `src/prediction/final-engine.ts::buildPrediction`.
- Six-target verification: `src/prediction/primary-contract-v2.ts`.
- Immutable shadow lock/fingerprint: `src/prediction/multi-market-live-shadow.ts`.
- Prospective paired OOS gate: `src/prediction/multi-market-locked-oos-gate.ts`.

## Isolation

The HF package contains no Supabase write client, Cloudflare deploy path, canonical upsert, settlement mutation, model promotion, or production dependency. Inputs are pinned immutable local/HTTPS artifacts. Direct `*.supabase.co` artifact URLs are rejected so the runtime cannot silently become a live production-DB reader.

Every emitted artifact is stamped:

- `research_only=true`
- `shadow_only=true`
- `production_mutation=false`
- `decision_use=false`
- `production_eligible=false`

The runtime refuses known production-write secrets (`SUPABASE_SERVICE_ROLE_KEY`, Cloudflare deploy tokens, CFI action/write keys) at boot.

## Data contract

Preferred full-corpus input is an exported immutable JSON artifact or a Hugging Face Dataset artifact. Every input must provide an expected SHA-256. HTTPS is allowed only with a matching content hash. The full production DB is never copied automatically.

The repository includes a small immutable real-CFI historical smoke slice solely for CI/E2E verification. Full-corpus data remains external/versioned.

## Runtime endpoints

- `GET /health` — build/version/mode and safety state.
- `POST /v1/jobs` — synchronous shadow job runner (`historical`, `shadow_prediction`, `locked_oos_gate`).
- `GET /v1/runs/<run-id>/manifest` — persisted artifact manifest.

Jobs are single-flight. Duplicate run IDs fail closed. Request payload is bounded.

## Historical job

A historical job executes both existing CFI paths:

1. R0/date-batched strict-prior replay + current champion/Future Six scorecard.
2. Multi-Market walk-forward benchmark for 1X2, O/U and AH with coherence guards.

The Multi-Market replay implementation is date-batched/incremental so full corpora do not incur the previous O(N²) prior scan.

## Shadow prediction job

A shadow input freezes fixture identity, kickoff, prediction lock time, and pre-match evidence streams. All evidence must be strictly older than both target date and prediction lock time. The existing CFI prediction core is invoked only after the audit passes. The result is six-target-verified, Multi-Market-coherence-checked, fingerprinted, and stored only under the HF artifact root.

## Prospective validation

Settled prospective rows use the existing locked-OOS gate. It requires valid pre-kickoff fingerprints, post-kickoff verified settlement, strict-prior evidence, no reconstruction, no prediction-history replay, paired baseline/candidate vectors, Brier/log-loss deltas, and a minimum sample gate. Passing remains shadow evidence only and cannot promote production.

## Validation gates

CI must prove:

- unit safety/strict-prior tests PASS;
- real immutable CFI smoke corpus loads by SHA-256;
- historical Multi-Market run PASS;
- shadow prediction locks and verifies;
- artifact manifest persists and duplicate run IDs fail;
- container boots and `/health` returns shadow-only state;
- short soak repeats jobs, recovers from an intentional rejected job, and produces no production writes.

## Promotion boundary

There is intentionally no HF → production connection in V1. Any future connection/promotion is a separate task requiring explicit approval after smoke, E2E, soak, strict-prior, output parity/coherence and failure-isolation gates pass.
