import {
  evaluateMultiMarketPromotion,
  MULTIMARKET_RESEARCH_CONTRACT_VERSION,
} from './multimarket-promotion-gate-v2.mjs';

function failClosed(modelType, reason, sampleCount = 0) {
  return {
    modelType,
    sampleCount,
    contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    status: 'FAIL_HARD_GATE',
    score: 0,
    productionEligible: false,
    shadowEligible: false,
    decisionUse: false,
    researchOnly: true,
    hardFailures: [reason],
  };
}

function verifyReplayStrictPrior(replay) {
  if (!replay?.strictPrior || replay?.sameDateLeakage !== false || replay?.temporalProvenanceComplete !== true) {
    return false;
  }
  for (const row of replay.evaluations ?? []) {
    if (!row?.targetTimestamp || !row?.maxEvidenceTimestamp || !(Date.parse(row.maxEvidenceTimestamp) < Date.parse(row.targetTimestamp))) {
      return false;
    }
    if (row.reconstructed === true || row.replayedPredictionHistory === true) return false;
  }
  return true;
}

export function scoreReplayModel(replay, modelType, options = {}) {
  if (!verifyReplayStrictPrior(replay)) {
    return failClosed(modelType, 'REPLAY_STRICT_PRIOR_FAILURE');
  }

  const evaluations = (replay.evaluations ?? []).filter(
    row => row.modelType === modelType && row.evidenceCount > 0 && row.maxEvidenceTimestamp,
  );
  if (!evaluations.length) {
    return failClosed(modelType, 'INSUFFICIENT_REAL_EVIDENCE');
  }

  const inputByModel = options.multiMarketPromotionInputs ?? {};
  const input = inputByModel[modelType] ?? options.multiMarketPromotionInput;
  if (!input || typeof input !== 'object') {
    return failClosed(modelType, 'MULTIMARKET_EVALUATION_REQUIRED', evaluations.length);
  }

  const result = evaluateMultiMarketPromotion({
    ...input,
    contractVersion: MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    decisionUse: false,
    productionMutationAllowed: false,
  });

  return {
    modelType,
    sampleCount: evaluations.length,
    ...result,
    decisionUse: false,
    researchOnly: true,
    productionEligible: false,
  };
}

export function scoreReplayAllModels(replay, options = {}) {
  const types = [...new Set((replay?.evaluations ?? []).map(row => row.modelType))];
  return Object.fromEntries(types.map(type => [type, scoreReplayModel(replay, type, options)]));
}
