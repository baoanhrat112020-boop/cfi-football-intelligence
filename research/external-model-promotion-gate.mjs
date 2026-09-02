import {
  evaluateMultiMarketPromotion,
  MULTIMARKET_RESEARCH_CONTRACT_VERSION,
} from './multimarket-promotion-gate-v2.mjs';
import { assessLeakageAdjustedGate } from './fusion/leakage-adjusted-gate.mjs';

function failClosed(reason, leakageAdjustedGate = null) {
  return {
    version: 'CFI_EXTERNAL_MODEL_MULTIMARKET_GATE_V2',
    contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    status: 'FAIL_HARD_GATE',
    score: 0,
    shadowEligible: false,
    productionEligible: false,
    decisionUse: false,
    researchOnly: true,
    hardFailures: [reason],
    leakageAdjustedGate,
  };
}

export function evaluateExternalModelRun(_rows, options = {}) {
  const input = options.multiMarketPromotionInput;
  if (!input || typeof input !== 'object') {
    return failClosed('MULTIMARKET_EVALUATION_REQUIRED');
  }

  const leakage = assessLeakageAdjustedGate(options.externalModelAudit ?? {});
  const base = evaluateMultiMarketPromotion({
    ...input,
    contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    decisionUse: false,
    productionMutationAllowed: false,
  });

  if (leakage.pass) {
    return {
      ...base,
      decisionUse: false,
      researchOnly: true,
      productionEligible: false,
      leakageAdjustedGate: leakage,
    };
  }

  const hardFailures = [...new Set([...(base.hardFailures ?? []), leakage.reason])];
  return {
    ...base,
    status: 'FAIL_HARD_GATE',
    shadowEligible: false,
    productionEligible: false,
    decisionUse: false,
    researchOnly: true,
    hardFailures,
    leakageAdjustedGate: leakage,
  };
}
