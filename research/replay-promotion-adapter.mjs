import { evaluateRun } from './promotion-gate.mjs';

const MARKET_MAP = {
  threePlusHT: 'threePlusHT',
  sevenPlusFT: 'sevenPlusFT',
  otherHT: 'otherHT',
  otherFT: 'otherFT',
};

function toPromotionRow(evaluation) {
  const probabilities = Object.fromEntries(Object.entries(MARKET_MAP).map(([dst, src]) => [dst, Number(evaluation.probabilities?.[src])]));
  const actual = Object.fromEntries(Object.entries(MARKET_MAP).map(([dst, src]) => [dst, evaluation.outcomes?.[src]]));
  return {
    targetTimestamp: `${evaluation.targetDate}T23:59:59Z`,
    maxEvidenceTimestamp: `${evaluation.targetDate}T00:00:00Z`,
    probabilities,
    actual,
    top3HT: evaluation.top3HT?.status === 'MODELED' ? Array.from({ length: 3 }, (_, i) => i + 1 === evaluation.top3HT.rankOfHit ? '__ACTUAL__' : `HT_${i}`) : [],
    top3FT: evaluation.top3FT?.status === 'MODELED' ? Array.from({ length: 3 }, (_, i) => i + 1 === evaluation.top3FT.rankOfHit ? '__ACTUAL__' : `FT_${i}`) : [],
    actualScore: { ht: '__ACTUAL__', ft: '__ACTUAL__' },
    reconstructed: false,
  };
}

export function scoreReplayModel(replay, modelType, options = {}) {
  if (!replay?.strictPrior || replay?.sameDateLeakage !== false) {
    return {
      modelType,
      status: 'FAIL_HARD_GATE',
      shadowEligible: false,
      productionEligible: false,
      hardFailures: ['REPLAY_STRICT_PRIOR_FAILURE'],
      score: 0,
    };
  }
  const evaluations = (replay.evaluations ?? []).filter((r) => r.modelType === modelType);
  const rows = evaluations.map(toPromotionRow);
  const result = evaluateRun(rows, options);
  return { modelType, sampleCount: rows.length, ...result };
}

export function scoreReplayAllModels(replay, options = {}) {
  const modelTypes = [...new Set((replay?.evaluations ?? []).map((r) => r.modelType))];
  return Object.fromEntries(modelTypes.map((m) => [m, scoreReplayModel(replay, m, options)]));
}
