import { MULTIMARKET_RESEARCH_CONTRACT_VERSION, REQUIRED_OUTPUT_GROUPS } from './multimarket-promotion-gate-v2.mjs';

export const MULTIMARKET_BASELINE_V22 = Object.freeze({
  version: 'CFI_MULTIMARKET_BASELINE_V2_2',
  contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalDbMutationAllowed: false,
  strictPriorRequired: true,
  reconstructionAllowed: false,
  requiredGroups: REQUIRED_OUTPUT_GROUPS,
});

export function assessBaselineArtifact(input = {}) {
  const hardFailures = [];
  if (input.contractVersion !== MULTIMARKET_RESEARCH_CONTRACT_VERSION) hardFailures.push('MULTIMARKET_RESEARCH_CONTRACT_VERSION_REQUIRED');
  if (input.researchOnly !== true) hardFailures.push('RESEARCH_ONLY_REQUIRED');
  if (input.decisionUse !== false) hardFailures.push('DECISION_USE_MUST_BE_FALSE');
  if (input.productionMutationAllowed === true) hardFailures.push('PRODUCTION_MUTATION_FORBIDDEN');
  if (input.canonicalDbMutationAllowed === true) hardFailures.push('CANONICAL_DB_MUTATION_FORBIDDEN');
  if (input.strictPrior !== true) hardFailures.push('STRICT_PRIOR_REQUIRED');
  if (input.reconstructed === true) hardFailures.push('RECONSTRUCTION_FORBIDDEN');
  if (!input.corpusFingerprint || typeof input.corpusFingerprint !== 'string') hardFailures.push('CORPUS_FINGERPRINT_REQUIRED');
  if (!Number.isInteger(input.fixtureCount) || input.fixtureCount < 30) hardFailures.push('BASELINE_FIXTURE_SUPPORT_REQUIRED');
  if (!Number.isInteger(input.evaluationRows) || input.evaluationRows < 30) hardFailures.push('BASELINE_EVALUATION_ROWS_REQUIRED');
  const coverage = input.outputCoverage ?? {};
  for (const group of REQUIRED_OUTPUT_GROUPS) if (coverage[group] !== true) hardFailures.push(`OUTPUT_${group}_REQUIRED`);
  const metrics = input.metrics ?? {};
  for (const key of ['aggregateBrier','aggregateLogLoss','calibrationEce']) if (!Number.isFinite(metrics[key])) hardFailures.push(`FINITE_${key.toUpperCase()}_REQUIRED`);
  const audits = input.audits ?? {};
  for (const key of ['coherence','directionalSwap','determinism','segmentRobustness']) if (audits[key]?.pass !== true) hardFailures.push(`${key.toUpperCase()}_AUDIT_REQUIRED`);
  return {
    version: MULTIMARKET_BASELINE_V22.version,
    contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    status: hardFailures.length ? 'FAIL_HARD_GATE' : 'BASELINE_REPRODUCIBLE',
    baselineReproducible: hardFailures.length === 0,
    decisionUse: false,
    researchOnly: true,
    productionEligible: false,
    hardFailures,
  };
}

export function classifyLegacyHistoricalRun(run = {}) {
  const legacy = run.contract_version !== 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.2';
  return {
    legacy,
    classification: legacy ? 'LEGACY_RESEARCH_CONTRACT' : 'CURRENT_RESEARCH_CONTRACT',
    promotionUseAllowed: false,
    decisionUse: false,
  };
}
