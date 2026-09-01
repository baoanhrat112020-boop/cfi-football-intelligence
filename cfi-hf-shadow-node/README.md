# CFI HF Shadow Node V1

This package runs CFI research workloads in an isolated Hugging Face Docker Space while reusing the repository's existing prediction/replay/Multi-Market code.

## Local validation

```bash
npm ci
node --experimental-strip-types --test tests/hf-shadow-node.test.mjs
node --experimental-strip-types cfi-hf-shadow-node/src/smoke.mjs
node --experimental-strip-types cfi-hf-shadow-node/src/soak.mjs
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

## Hugging Face deployment

Use a separate private Docker Space; do not overwrite the existing public/static CFI intelligence presence.

```bash
python -m pip install -U huggingface_hub
hf auth login
HF_SPACE_ID=CFIAI/cfi-football-intelligence-shadow-v1 ./cfi-hf-shadow-node/deploy-hf.sh
```

The deployment script creates/updates a private Docker Space, stages this repository, promotes the HF-specific Dockerfile and README to the Space root, and sets only non-secret shadow variables.

For a large/private corpus, prefer a separate versioned HF Dataset repository mounted read-only into the Space, then pass its local mounted file path plus exact SHA-256 in each job. Do not store a Supabase service-role key in the Space. This V1 runtime deliberately refuses production-write secrets.

## Artifact persistence

By default artifacts are written under `/artifacts`. On free/ephemeral Space storage they are not durable across rebuilds. For durable research artifacts, attach a dedicated HF persistent volume/bucket or export artifacts to a separate research artifact store in a later isolated task. No production DB fallback is implemented.
