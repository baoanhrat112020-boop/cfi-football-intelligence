import { FINAL_VERSION } from '../src/prediction/final-engine.ts';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION } from './multimarket-promotion-gate-v2.mjs';
import { MULTI_MARKET_HISTORICAL_V2 } from './multi-market-historical-learning-v2.mjs';

export const R0_BASELINE_EXECUTION_GATE_VERSION = 'CFI_R0_BASELINE_EXECUTION_GATE_V1';

export function evaluateR0BaselineExecutionParity(input = {}) {
  const expected = input.expected ?? {};
  const actual = input.actual ?? {};
  const hardFailures = [];

  if (!expected.sourceCommit || actual.sourceCommit !== expected.sourceCommit) hardFailures.push('SOURCE_COMMIT_PARITY_REQUIRED');
  if (!expected.corpusFingerprint || actual.corpusFingerprint !== expected.corpusFingerprint) hardFailures.push('CORPUS_FINGERPRINT_PARITY_REQUIRED');
  if (actual.engineVersion !== FINAL_VERSION) hardFailures.push('FINAL_ENGINE_PARITY_REQUIRED');
  if (actual.multiMarketContract !== MULTIMARKET_RESEARCH_CONTRACT_VERSION) hardFailures.push('MULTIMARKET_CONTRACT_PARITY_REQUIRED');
  if (actual.historicalContract !== MULTI_MARKET_HISTORICAL_V2.version) hardFailures.push('HISTORICAL_CONTRACT_PARITY_REQUIRED');
  if (actual.strictPrior !== true) hardFailures.push('STRICT_PRIOR_REQUIRED');
  if (actual.sameDateLeakage !== false) hardFailures.push('SAME_DATE_EXCLUSION_REQUIRED');
  if (actual.noReconstruction !== true) hardFailures.push('NO_RECONSTRUCTION_REQUIRED');
  if (actual.decisionUse !== false) hardFailures.push('DECISION_USE_MUST_BE_FALSE');
  if (actual.productionMutationAllowed !== false) hardFailures.push('PRODUCTION_MUTATION_FORBIDDEN');
  if (actual.canonicalMutationAllowed !== false) hardFailures.push('CANONICAL_MUTATION_FORBIDDEN');

  return {
    version: R0_BASELINE_EXECUTION_GATE_VERSION,
    status: hardFailures.length ? 'BLOCKED_ENGINE_PARITY' : 'READY_FOR_REPLAY',
    ready: hardFailures.length === 0,
    researchOnly: true,
    decisionUse: false,
    productionEligible: false,
    hardFailures,
    expected: {
      sourceCommit: expected.sourceCommit ?? null,
      corpusFingerprint: expected.corpusFingerprint ?? null,
      engineVersion: FINAL_VERSION,
      multiMarketContract: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
      historicalContract: MULTI_MARKET_HISTORICAL_V2.version,
    },
  };
}
