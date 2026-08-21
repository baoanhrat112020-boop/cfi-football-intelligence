import { evaluateRun } from './promotion-gate.mjs';

function top3FromAudit(audit, prefix) {
  if (!audit || audit.status !== 'MODELED') return [];
  return Array.from({ length: 3 }, (_, i) => i + 1 === audit.rankOfHit ? '__ACTUAL__' : `${prefix}_${i+1}`);
}

function toPromotionRow(evaluation) {
  return {
    targetTimestamp: evaluation.targetTimestamp,
    maxEvidenceTimestamp: evaluation.maxEvidenceTimestamp,
    probabilities: evaluation.probabilities,
    actual: evaluation.outcomes,
    top3HT: top3FromAudit(evaluation.top3HT, 'HT'),
    top3FT: top3FromAudit(evaluation.top3FT, 'FT'),
    actualScore: { ht: '__ACTUAL__', ft: '__ACTUAL__' },
    reconstructed: false,
  };
}

export function scoreReplayModel(replay, modelType, options = {}) {
  if (!replay?.strictPrior || replay?.sameDateLeakage !== false || replay?.temporalProvenanceComplete !== true) {
    return { modelType, sampleCount: 0, score: 0, status: 'FAIL_HARD_GATE', productionEligible: false, shadowEligible: false, hardFailures: ['REPLAY_STRICT_PRIOR_FAILURE'] };
  }
  const evaluations = (replay.evaluations ?? []).filter(r => r.modelType === modelType && r.evidenceCount > 0 && r.maxEvidenceTimestamp);
  if (!evaluations.length) {
    return { modelType, sampleCount: 0, score: 0, status: 'FAIL_HARD_GATE', productionEligible: false, shadowEligible: false, hardFailures: ['INSUFFICIENT_REAL_EVIDENCE'] };
  }
  const result = evaluateRun(evaluations.map(toPromotionRow), options);
  return { modelType, sampleCount: evaluations.length, ...result };
}

export function scoreReplayAllModels(replay, options = {}) {
  const types = [...new Set((replay?.evaluations ?? []).map(r => r.modelType))];
  return Object.fromEntries(types.map(type => [type, scoreReplayModel(replay, type, options)]));
}
