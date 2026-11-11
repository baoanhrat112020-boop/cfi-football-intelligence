import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertShadowEnvironment } from '../cfi-hf-shadow-node/src/config.mjs';
import { loadPinnedArtifact, sha256Bytes, sha256File } from '../cfi-hf-shadow-node/src/data-source.mjs';
import { auditStrictPrior } from '../cfi-hf-shadow-node/src/strict-prior.mjs';
import { runHistoricalJob } from '../cfi-hf-shadow-node/src/jobs.mjs';
import { persistRunArtifact } from '../cfi-hf-shadow-node/src/artifacts.mjs';
import { settleLockedShadow } from '../cfi-hf-shadow-node/src/settlement.mjs';
import { runSmoke } from '../cfi-hf-shadow-node/src/smoke.mjs';
import { lockMultiMarketShadow } from '../src/prediction/multi-market-live-shadow.ts';

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

test('historical learning excludes incomplete/upcoming rows before replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-settled-filter-'));
  const corpus = JSON.parse(await readFile(realCorpusPath, 'utf8'));
  corpus.dataset_version = 'CFI_HF_SETTLED_FILTER_TEST_V1';
  corpus.fixtures.push({ fixture_id: 'UPCOMING-TEST-ONLY', match_date: '2099-01-01', home_team: 'Wigan', away_team: 'Gillingham', ht_home: null, ht_away: null, ft_home: null, ft_away: null, status: 'SCHEDULED' });
  const text = `${JSON.stringify(corpus)}\n`;
  const path = join(root, 'corpus.json');
  await writeFile(path, text, 'utf8');
  const result = await runHistoricalJob({ kind: 'historical', dataset: { location: path, sha256: sha256Bytes(Buffer.from(text)), version: corpus.dataset_version } });
  assert.equal(result.output.source_fixture_count, corpus.fixtures.length);
  assert.equal(result.output.corpus_fixture_count, corpus.fixtures.length - 1);
  assert.equal(result.output.rejected_incomplete_fixtures, 1);
});

test('artifact persistence is append-only by run id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-artifact-test-'));
  const args = { root, runId: 'HF-TEST-APPEND-ONLY-01', kind: 'unit', dataset: null, modelVersion: 'TEST', strictPriorAudit: { verified: true }, output: { ok: true } };
  await persistRunArtifact(args);
  await assert.rejects(persistRunArtifact(args));
});

test('shadow settlement is post-kickoff, fingerprinted, metric-producing and artifact-only', () => {
  const payload = {
    research_only: true,
    shadow_only: true,
    production_mutation: false,
    fixture: { fixture_id: 'TEST-SETTLE-01', kickoff_at: '2026-01-02T12:00:00.000Z' },
    prediction_timestamp: '2026-01-02T10:00:00.000Z',
    strict_prior: { verified: true, futureEvidenceCount: 0, sameDateEvidenceCount: 0 },
    markets: {
      '3+ HT': { final: 0.7 },
      '7+ FT': { final: 0.2 },
      'Other HT': { final: 0.1 },
      'Other FT': { final: 0.3 },
    },
    primary_targets: { scorelineTargets: {
      'Top-1 HT': { final: { score: '1-0', probability: 0.2 } },
      'Top-1 FT': { final: { score: '2-1', probability: 0.15 } },
    } },
  };
  const locked = lockMultiMarketShadow({ fixtureId: 'TEST-SETTLE-01', targetDate: '2026-01-02', createdAt: '2026-01-02T10:00:00.000Z', modelVersion: 'TEST', payload });
  const result = { verified_at: '2026-01-02T15:00:00.000Z', ht: { home: 1, away: 0 }, ft: { home: 2, away: 1 } };
  assert.throws(() => settleLockedShadow({ lockedShadow: locked, result, nowMs: Date.parse('2026-01-02T11:59:59.000Z') }), /BEFORE_KICKOFF/);
  const settled = settleLockedShadow({ lockedShadow: locked, result, nowMs: Date.parse('2026-01-02T16:00:00.000Z') });
  assert.equal(settled.canonical_settlement_write, false);
  assert.equal(settled.production_mutation, false);
  assert.equal(settled.exact_score_metrics['Top-1 HT'].hit, true);
  assert.equal(settled.exact_score_metrics['Top-1 FT'].hit, true);
  assert.ok(Number.isFinite(settled.threshold_metrics['3+ HT'].brier));
  assert.ok(Number.isFinite(settled.threshold_metrics['3+ HT'].log_loss));
});

test('HF shadow smoke proves historical + six-target shadow artifact without production writes', async () => {
  const result = await runSmoke();
  assert.equal(result.status, 'PASS');
  assert.equal(result.real_immutable_input, true);
  assert.equal(result.multi_market_run, true);
  assert.equal(result.shadow_artifact, true);
  assert.equal(result.production_mutation, false);
});
