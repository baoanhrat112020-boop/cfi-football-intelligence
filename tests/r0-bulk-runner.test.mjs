import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeR0Corpus, runR0Bulk, R0_DATASET_CONTRACT } from '../research/run-r0-bulk.mjs';

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

test('R0 contract is pinned to current production release and numerical core', () => {
  assert.equal(R0_DATASET_CONTRACT.productionChampion, 'CFI_FINAL_V5.2.5');
  assert.equal(R0_DATASET_CONTRACT.productionEntrypoint, 'cloudflare-worker/src/index-v55.ts');
  assert.equal(R0_DATASET_CONTRACT.productionRuntime, 'CFI_SIX_TARGET_RUNTIME_V1.4');
  assert.equal(R0_DATASET_CONTRACT.bigDbRetrieval, 'CFI_BIG_DB_RETRIEVAL_V2.1.2');
  assert.match(R0_DATASET_CONTRACT.numericalCore, /buildPrediction/);
});

test('R0 bulk runner is research-only, strict-prior, and reports production parity', () => {
  const result = runR0Bulk(rows, { minPrior: 8 });
  assert.equal(result.replay.strictPrior, true);
  assert.equal(result.replay.sameDateLeakage, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.productionParity.releaseEngine, 'CFI_FINAL_V5.2.5');
  assert.equal(result.productionParity.directGlobalPriorShrinkage, false);
  assert.ok(['HOLD', 'SHADOW_ELIGIBLE_ONLY'].includes(result.promotionDecision));
});
