import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistRunArtifact } from './artifacts.mjs';
import { sha256Bytes, sha256File } from './data-source.mjs';
import { runHistoricalJob, runShadowPredictionJob } from './jobs.mjs';

const realCorpusPath = fileURLToPath(new URL('../testdata/real-cfi-smoke-corpus.json', import.meta.url));

export async function runSmoke() {
  const root = await mkdtemp(join(tmpdir(), 'cfi-hf-smoke-'));
  const corpusSha = await sha256File(realCorpusPath);
  const historical = await runHistoricalJob({
    kind: 'historical',
    dataset: { location: realCorpusPath, sha256: corpusSha, version: 'CFI_HF_REAL_SMOKE_ENGLAND_E2_2016_V1' },
  });
  if (!historical.strictPriorAudit?.verified || historical.output?.multi_market?.leakage !== false) throw new Error('SMOKE_HISTORICAL_FAILED');
  await persistRunArtifact({ root, runId: 'HF-SMOKE-HISTORICAL-V1', kind: historical.kind, dataset: historical.dataset, modelVersion: historical.modelVersion, strictPriorAudit: historical.strictPriorAudit, output: historical.output });

  const corpus = JSON.parse(await readFile(realCorpusPath, 'utf8'));
  const now = new Date().toISOString();
  const snapshot = {
    dataset_version: 'CFI_HF_TEST_ONLY_PROSPECTIVE_SNAPSHOT_V1',
    test_only: true,
    fixture: {
      fixture_id: 'HF-TEST-WIGAN-GILLINGHAM-2099',
      target_date: '2099-01-01',
      home_team: 'Wigan',
      away_team: 'Gillingham',
      kickoff_at: '2099-01-01T12:00:00.000Z'
    },
    prediction_lock_time: now,
    homePayload: corpus.fixtures,
    awayPayload: corpus.fixtures,
    h2hPayload: corpus.fixtures.filter((x) => ['Wigan','Gillingham'].includes(x.home_team) && ['Wigan','Gillingham'].includes(x.away_team))
  };
  const snapshotText = `${JSON.stringify(snapshot)}\n`;
  const snapshotPath = join(root, 'shadow-input.json');
  await writeFile(snapshotPath, snapshotText, 'utf8');
  const shadow = await runShadowPredictionJob({
    kind: 'shadow_prediction',
    snapshot: { location: snapshotPath, sha256: sha256Bytes(Buffer.from(snapshotText)), version: snapshot.dataset_version },
  });
  if (!shadow.strictPriorAudit?.verified || shadow.output?.locked_shadow?.payload?.six_target_verification?.complete !== true) throw new Error('SMOKE_SHADOW_FAILED');
  await persistRunArtifact({ root, runId: 'HF-SMOKE-SHADOW-V1', kind: shadow.kind, dataset: shadow.dataset, modelVersion: shadow.modelVersion, strictPriorAudit: shadow.strictPriorAudit, output: shadow.output });

  let duplicateRejected = false;
  try {
    await persistRunArtifact({ root, runId: 'HF-SMOKE-SHADOW-V1', kind: shadow.kind, dataset: shadow.dataset, modelVersion: shadow.modelVersion, strictPriorAudit: shadow.strictPriorAudit, output: shadow.output });
  } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error('SMOKE_DUPLICATE_RUN_NOT_REJECTED');

  return {
    status: 'PASS',
    real_immutable_input: true,
    historical_strict_prior: true,
    multi_market_run: true,
    shadow_artifact: true,
    duplicate_run_rejected: true,
    production_mutation: false,
    artifact_root: root,
    evaluated_multi_market_matches: historical.output.multi_market.evaluatedMatches,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSmoke().then((x) => process.stdout.write(`${JSON.stringify(x)}\n`)).catch((error) => { console.error(error?.stack ?? String(error)); process.exitCode = 1; });
}
