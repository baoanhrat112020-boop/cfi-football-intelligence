import test from 'node:test';
import assert from 'node:assert/strict';
import { FINAL_VERSION } from '../src/prediction/final-engine.ts';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION } from '../research/multimarket-promotion-gate-v2.mjs';
import { MULTI_MARKET_HISTORICAL_V2 } from '../research/multi-market-historical-learning-v2.mjs';
import { evaluateR0BaselineExecutionParity } from '../research/r0-baseline-execution-gate.mjs';

const expected = {
  sourceCommit: 'abc123',
  corpusFingerprint: 'fingerprint-1',
};

const valid = {
  sourceCommit: expected.sourceCommit,
  corpusFingerprint: expected.corpusFingerprint,
  engineVersion: FINAL_VERSION,
  multiMarketContract: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
  historicalContract: MULTI_MARKET_HISTORICAL_V2.version,
  strictPrior: true,
  sameDateLeakage: false,
  noReconstruction: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalMutationAllowed: false,
};

test('current engine + V2.2 contracts + frozen corpus can become READY_FOR_REPLAY', () => {
  const r = evaluateR0BaselineExecutionParity({ expected, actual: valid });
  assert.equal(r.status, 'READY_FOR_REPLAY');
  assert.equal(r.ready, true);
  assert.deepEqual(r.hardFailures, []);
  assert.equal(r.productionEligible, false);
  assert.equal(r.decisionUse, false);
});

test('stale engine is blocked before replay', () => {
  const r = evaluateR0BaselineExecutionParity({ expected, actual: { ...valid, engineVersion: 'CFI_FINAL_V5.2.2' } });
  assert.equal(r.ready, false);
  assert.ok(r.hardFailures.includes('FINAL_ENGINE_PARITY_REQUIRED'));
});

test('corpus drift is blocked before replay', () => {
  const r = evaluateR0BaselineExecutionParity({ expected, actual: { ...valid, corpusFingerprint: 'changed' } });
  assert.equal(r.ready, false);
  assert.ok(r.hardFailures.includes('CORPUS_FINGERPRINT_PARITY_REQUIRED'));
});

test('research isolation cannot be weakened', () => {
  const r = evaluateR0BaselineExecutionParity({ expected, actual: { ...valid, decisionUse: true, productionMutationAllowed: true, canonicalMutationAllowed: true } });
  assert.equal(r.ready, false);
  assert.ok(r.hardFailures.includes('DECISION_USE_MUST_BE_FALSE'));
  assert.ok(r.hardFailures.includes('PRODUCTION_MUTATION_FORBIDDEN'));
  assert.ok(r.hardFailures.includes('CANONICAL_MUTATION_FORBIDDEN'));
});
