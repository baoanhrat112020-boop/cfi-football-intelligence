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

test('R0 bulk runner is research-only and strict-prior', () => {
  const result = runR0Bulk(rows, { minPrior: 8 });
  assert.equal(result.replay.strictPrior, true);
  assert.equal(result.replay.sameDateLeakage, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.ok(['HOLD', 'SHADOW_ELIGIBLE_ONLY'].includes(result.promotionDecision));
});
