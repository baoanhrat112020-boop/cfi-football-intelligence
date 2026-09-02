import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeR0Corpus, restrictReplayToResearchWindow, runR0Bulk, R0_DATASET_CONTRACT } from '../research/run-r0-bulk.mjs';

const rows = Array.from({ length: 24 }, (_, i) => {
  const day = String((i % 20) + 1).padStart(2, '0');
  const year = i < 2 ? 2015 : 2016;
  return {
    id: `f${i}`,
    matchDate: `${year}-01-${day}`,
    homeTeam: i % 2 ? 'Beta' : 'Alpha',
    awayTeam: i % 2 ? 'Alpha' : 'Beta',
    ht: { home: i % 4 === 0 ? 2 : 1, away: i % 5 === 0 ? 1 : 0 },
    ft: { home: i % 6 === 0 ? 5 : 2, away: i % 7 === 0 ? 2 : 1 },
  };
});

test('R0 corpus contract freezes prospective holdout', () => {
  const input = [...rows, { ...rows[0], id: 'future', matchDate: '2026-08-20' }];
  const frozen = freezeR0Corpus(input);
  assert.equal(frozen.some(r => r.id === 'future'), false);
  assert.equal(R0_DATASET_CONTRACT.prospectiveHoldoutStart, '2026-08-20');
});

test('R0 contract is pinned to reproducible V2.2 release and actual replay prior gate', () => {
  assert.equal(R0_DATASET_CONTRACT.baselineCommitSha, '8ca9a3634f536f2f838135df062f5bbbf7da0d9a');
  assert.equal(R0_DATASET_CONTRACT.productionChampion, 'CFI_FINAL_V5.3.1');
  assert.equal(R0_DATASET_CONTRACT.productionEntrypoint, 'cloudflare-worker/src/index-live-router.ts');
  assert.equal(R0_DATASET_CONTRACT.prematchEntrypoint, 'cloudflare-worker/src/index-v55.ts');
  assert.equal(R0_DATASET_CONTRACT.productionRuntime, 'CFI_PRIMARY_TOP1_RUNTIME_V2');
  assert.equal(R0_DATASET_CONTRACT.primaryContract, 'CFI_2_METHODS_X_6_TARGETS_V2');
  assert.equal(R0_DATASET_CONTRACT.multiMarketVersion, 'CFI_MULTI_MARKET_V1');
  assert.equal(R0_DATASET_CONTRACT.crossMarketCoherence, 'CFI_CROSS_MARKET_COHERENCE_GATE_V1');
  assert.equal(R0_DATASET_CONTRACT.historicalEvaluator, 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.2');
  assert.equal(R0_DATASET_CONTRACT.bigDbRetrieval, 'CFI_BIG_DB_RETRIEVAL_V2.1.2');
  assert.equal(R0_DATASET_CONTRACT.minGlobalPriorFixtures, 8);
  assert.equal(R0_DATASET_CONTRACT.decisionUse, false);
  assert.equal(R0_DATASET_CONTRACT.productionMutationAllowed, false);
  assert.equal('minTeamPrior' in R0_DATASET_CONTRACT, false);
  assert.match(R0_DATASET_CONTRACT.numericalCore, /buildPrediction/);
});

test('2015 is warm-up only and never contributes scoring rows', () => {
  const replay = {
    evaluations: [
      { fixtureId: 'warm', targetDate: '2015-12-31' },
      { fixtureId: 'score', targetDate: '2016-01-01' },
      { fixtureId: 'holdout', targetDate: '2026-08-20' },
    ],
  };
  const filtered = restrictReplayToResearchWindow(replay);
  assert.deepEqual(filtered.evaluations.map(x => x.fixtureId), ['score']);
});

test('R0 bulk runner is research-only, strict-prior, and scores research window only', () => {
  const result = runR0Bulk(rows);
  assert.equal(result.baselineVerification.status, 'PASS');
  assert.equal(result.replay.strictPrior, true);
  assert.equal(result.replay.sameDateLeakage, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.decisionUse, false);
  assert.equal(result.productionParity.baselineCommitSha, '8ca9a3634f536f2f838135df062f5bbbf7da0d9a');
  assert.equal(result.productionParity.releaseEngine, 'CFI_FINAL_V5.3.1');
  assert.equal(result.productionParity.runtime, 'CFI_PRIMARY_TOP1_RUNTIME_V2');
  assert.equal(result.productionParity.primaryContract, 'CFI_2_METHODS_X_6_TARGETS_V2');
  assert.equal(result.productionParity.multiMarketVersion, 'CFI_MULTI_MARKET_V1');
  assert.equal(result.productionParity.verifiedByExactSourceBlobLock, true);
  assert.equal(result.productionParity.directGlobalPriorShrinkage, false);
  assert.deepEqual(result.replay.scoringWindow, { start: '2016-01-01', end: '2026-08-19' });
  assert.ok(['HOLD', 'SHADOW_ELIGIBLE_ONLY'].includes(result.promotionDecision));
});