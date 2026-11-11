# CFI HF Shadow Node V1

This package runs CFI research workloads in an isolated shadow environment while reusing the repository's existing prediction/replay/Multi-Market code.

## Free-first execution

The default zero-paid-resource path is GitHub Actions workflow `CFI Shadow Free Run` (`.github/workflows/hf-shadow-free-run.yml`). It is manual-only, uses the smallest standard Linux runner, has a 30-minute timeout, uploads shadow artifacts for 7 days, and never requires a Hugging Face token or any production secret.

Supported free-first modes:

- `smoke` — built-in immutable real-CFI smoke corpus.
- `historical` — external immutable JSON artifact plus exact SHA-256 and version.
- `locked_oos_gate` — immutable locked prospective evaluation rows plus exact SHA-256 and version.

For private repositories, GitHub-hosted execution consumes the account's included Actions minutes. The workflow does not request larger runners or any explicitly paid compute resource. Keep runs manual and bounded so they remain inside the included allowance.

## Local validation

```bash
npm ci
node --experimental-strip-types --test tests/hf-shadow-node.test.mjs
node --experimental-strip-types cfi-hf-shadow-node/src/smoke.mjs
node --experimental-strip-types cfi-hf-shadow-node/src/soak.mjs
CFI_FREE_RUN_MODE=smoke node --experimental-strip-types cfi-hf-shadow-node/src/free-run.mjs
docker build -f cfi-hf-shadow-node/Dockerfile -t cfi-hf-shadow-node:v1 .
docker run --rm -p 7860:7860 cfi-hf-shadow-node:v1
```

`GET http://127.0.0.1:7860/health` must report `shadow_only=true` and `production_mutation=false`.

## Job input

All data inputs are pinned artifacts:

```json
{
  "kind": "historical",
  "run_id": "HF-HIST-20260901-001",
  "dataset": {
    "location": "/datasets/cfi-corpus/corpus.json",
    "sha256": "<64 hex chars>",
    "version": "CFI_CORPUS_2026_09_01_V1"
  }
}
```

For prospective shadow prediction, use `kind=shadow_prediction` and a pinned snapshot containing fixture identity, `kickoff_at`, `prediction_lock_time`, and `homePayload`/`awayPayload`/`h2hPayload`. The runtime rejects same-date/future evidence and any execution at or after kickoff.

## Hugging Face deployment — optional later

Hugging Face compute is not required for the free-first path. Keep this deployment option disabled until a paid-plan/eligible HF execution path is explicitly approved.

When enabled later, use a separate private Docker Space; do not overwrite any public/static CFI presence.

```bash
python -m pip install -U huggingface_hub
hf auth login
./cfi-hf-shadow-node/deploy-hf.sh
```

The deployment script creates/updates a private Docker Space under the authenticated Hugging Face namespace, stages this repository, promotes the HF-specific Dockerfile and README to the Space root, and sets only non-secret shadow variables.

For a large/private corpus, prefer a separate immutable/versioned research artifact and pass its local/HTTPS location plus exact SHA-256 in each job. Do not store a Supabase service-role key in the Space. This V1 runtime deliberately refuses production-write secrets.

## Artifact persistence

Local/Docker artifacts are append-only by run ID. Free-first GitHub Actions exports them as short-retention workflow artifacts. No production DB fallback is implemented.
