import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { persistRunArtifact } from './artifacts.mjs';
import { runHistoricalJob, runLockedOosGateJob } from './jobs.mjs';
import { sha256File } from './data-source.mjs';
import { runSmoke } from './smoke.mjs';

const mode = String(process.env.CFI_FREE_RUN_MODE ?? 'smoke').trim().toLowerCase();
const root = resolve(process.env.CFI_HF_ARTIFACT_ROOT ?? './cfi-hf-shadow-artifacts');
await mkdir(root, { recursive: true });

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function persist(result, runId) {
  const saved = await persistRunArtifact({
    root,
    runId,
    kind: result.kind,
    dataset: result.dataset ?? null,
    modelVersion: result.modelVersion ?? 'UNKNOWN',
    strictPriorAudit: result.strictPriorAudit ?? { verified: false },
    output: result.output,
  });
  return saved.manifest;
}

if (mode === 'smoke') {
  const result = await runSmoke();
  console.log(JSON.stringify({ execution_backend: 'GITHUB_ACTIONS_FREE_FIRST', paid_compute_required: false, ...result }));
  process.exit(result.status === 'PASS' ? 0 : 1);
}

if (mode === 'historical') {
  const location = required('CFI_FREE_DATASET_LOCATION');
  const sha256 = String(process.env.CFI_FREE_DATASET_SHA256 ?? '').trim() || (location.startsWith('http') ? '' : await sha256File(location));
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('CFI_FREE_DATASET_SHA256_REQUIRED_FOR_IMMUTABLE_INPUT');
  const version = required('CFI_FREE_DATASET_VERSION');
  const runId = String(process.env.CFI_FREE_RUN_ID ?? `FREE-HIST-${Date.now()}`).trim();
  const result = await runHistoricalJob({
    kind: 'historical',
    dataset: { location, sha256, version },
    options: {
      min_team_prior: Number(process.env.CFI_FREE_MIN_TEAM_PRIOR ?? 1),
      history_cap: Number(process.env.CFI_FREE_HISTORY_CAP ?? 10),
    },
  });
  const manifest = await persist(result, runId);
  console.log(JSON.stringify({
    status: 'PASS',
    execution_backend: 'GITHUB_ACTIONS_FREE_FIRST',
    paid_compute_required: false,
    run_id: runId,
    strict_prior: result.strictPriorAudit?.verified === true,
    production_mutation: false,
    corpus_fixture_count: result.output?.corpus_fixture_count ?? null,
    evaluated_multi_market_matches: result.output?.multi_market?.evaluatedMatches ?? null,
    manifest,
  }));
  process.exit(0);
}

if (mode === 'locked_oos_gate') {
  const location = required('CFI_FREE_DATASET_LOCATION');
  const sha256 = required('CFI_FREE_DATASET_SHA256');
  const version = required('CFI_FREE_DATASET_VERSION');
  const runId = String(process.env.CFI_FREE_RUN_ID ?? `FREE-OOS-${Date.now()}`).trim();
  const result = await runLockedOosGateJob({
    kind: 'locked_oos_gate',
    dataset: { location, sha256, version },
    model_version: String(process.env.CFI_FREE_MODEL_VERSION ?? 'LOCKED_CHALLENGER'),
  });
  const manifest = await persist(result, runId);
  console.log(JSON.stringify({
    status: 'PASS',
    execution_backend: 'GITHUB_ACTIONS_FREE_FIRST',
    paid_compute_required: false,
    run_id: runId,
    production_mutation: false,
    manifest,
  }));
  process.exit(0);
}

throw new Error(`UNSUPPORTED_CFI_FREE_RUN_MODE:${mode}`);
