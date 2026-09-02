import test from 'node:test';
import assert from 'node:assert/strict';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION, REQUIRED_OUTPUT_GROUPS } from '../research/multimarket-promotion-gate-v2.mjs';
import { assessBaselineArtifact, classifyLegacyHistoricalRun } from '../research/multimarket-baseline-v22.mjs';

const outputCoverage = Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group => [group, true]));
const valid = {
  contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalDbMutationAllowed: false,
  strictPrior: true,
  reconstructed: false,
  corpusFingerprint: 'sha256:test-corpus',
  fixtureCount: 100,
  evaluationRows: 100,
  outputCoverage,
  metrics: { aggregateBrier: .18, aggregateLogLoss: .62, calibrationEce: .04 },
  audits: {
    coherence: { pass: true }, directionalSwap: { pass: true }, determinism: { pass: true }, segmentRobustness: { pass: true },
  },
};

test('fresh full-contract baseline can become reproducible but never production eligible', () => {
  const result = assessBaselineArtifact(valid);
  assert.equal(result.status, 'BASELINE_REPRODUCIBLE');
  assert.equal(result.baselineReproducible, true);
  assert.equal(result.productionEligible, false);
  assert.equal(result.decisionUse, false);
});

test('partial or legacy baseline fails closed', () => {
  const result = assessBaselineArtifact({ ...valid, outputCoverage: { CHAMPION_6: true } });
  assert.equal(result.baselineReproducible, false);
  assert.ok(result.hardFailures.some(x => x.startsWith('OUTPUT_')));
});

test('reconstructed baseline is forbidden', () => {
  const result = assessBaselineArtifact({ ...valid, reconstructed: true });
  assert.equal(result.baselineReproducible, false);
  assert.ok(result.hardFailures.includes('RECONSTRUCTION_FORBIDDEN'));
});

test('V2.1 historical run is explicitly legacy and cannot be used for promotion', () => {
  const result = classifyLegacyHistoricalRun({ contract_version: 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1' });
  assert.equal(result.classification, 'LEGACY_RESEARCH_CONTRACT');
  assert.equal(result.promotionUseAllowed, false);
});
