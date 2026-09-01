import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertShadowEnvironment } from '../cfi-hf-shadow-node/src/config.mjs';
import { loadPinnedArtifact, sha256File } from '../cfi-hf-shadow-node/src/data-source.mjs';
import { auditStrictPrior } from '../cfi-hf-shadow-node/src/strict-prior.mjs';
import { runHistoricalJob } from '../cfi-hf-shadow-node/src/jobs.mjs';
import { persistRunArtifact } from '../cfi-hf-shadow-node/src/artifacts.mjs';
import { runSmoke } from '../cfi-hf-shadow-node/src/smoke.mjs';

const realCorpusPath = fileURLToPath(new URL('../cfi-hf-shadow-node/testdata/real-cfi-smoke-corpus.json', import.meta.url));

test('HF shadow boot rejects production write secrets', () => {
  assert.throws(() => assertShadowEnvironment({ CFI_HF_SHADOW_MODE: '1', SUPABASE_SERVICE_ROLE_KEY: 'x' }), /PRODUCTION_WRITE_SECRET_FORBIDDEN/);
  assert.deepEqual(assertShadowEnvironment({ CFI_HF_SHADOW_MODE: '1' }), { shadowMode: true, productionWriteSecretsPresent: false });
});

test('HF strict-prior rejects same-date evidence even when it predates lock time', () => {
  const audit = auditStrictPrior({
    targetDate: '2026-09-01',
    predictionLockTime: '2026-09-01T10:00:00.000Z',
    evidence: [{ match_date: '2026-09-01', evidence_timestamp: '2026-09-01T09:00:00.000Z' }],
  });
  assert.equal(audit.verified, false);
  assert.equal(audit.sameDateEvidenceCount, 1);
});

test('pinned artifact loader requires exact SHA-256 and forbids direct Supabase URLs', async () => {
  const sha = await sha256File(realCorpusPath);
  const loaded = await loadPinnedArtifact({ location: realCorpusPath, sha256: sha, version: 'CFI_HF_REAL_SMOKE_ENGLAND_E2_2016_V1' });
  assert.equal(loaded.sha256, sha);
  await assert.rejects(loadPinnedArtifact({ location: realCorpusPath, sha256: '0'.repeat(64), version: 'x' }), /HASH_MISMATCH/);
  await assert.rejects(loadPinnedArtifact({ location: 'https://abc.supabase.co/storage/v1/object/x', sha256: '0'.repeat(64), version: 'x' }), /DIRECT_SUPABASE_ARTIFACT_READ_FORBIDDEN/);
});

test('real immutable CFI smoke slice runs strict-prior R0 and Multi-Market benchmark', async () => {
  const sha = await sha256File(realCorpusPath);
  const result = await runHistoricalJob({ kind: 'historical', dataset: { location: realCorpusPath, sha256: sha, version: 'CFI_HF_REAL_SMOKE_ENGLAND_E2_2016_V1' } });
  assert.equal(result.strictPriorAudit.verified, true);
  assert.equal(result.output.research_only, true);
  assert.equal(result.output.production_mutation, false);
  assert.equal(result.output.multi_market.leakage, false);
  assert.ok(result.output.multi_market.evaluatedMatches > 0);
});

test('artifact persistence is append-only by run id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-artifact-test-'));
  const args = { root, runId: 'HF-TEST-APPEND-ONLY-01', kind: 'unit', dataset: null, modelVersion: 'TEST', strictPriorAudit: { verified: true }, output: { ok: true } };
  await persistRunArtifact(args);
  await assert.rejects(persistRunArtifact(args));
});

test('HF shadow smoke proves historical + six-target shadow artifact without production writes', async () => {
  const result = await runSmoke();
  assert.equal(result.status, 'PASS');
  assert.equal(result.real_immutable_input, true);
  assert.equal(result.multi_market_run, true);
  assert.equal(result.shadow_artifact, true);
  assert.equal(result.production_mutation, false);
});
