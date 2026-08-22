export const LIVING_BENCHMARK_VERSION = 'CFI_LIVING_BENCHMARK_V1';

export function assertPreRegistration({ targetDate, maxEvidenceDate, lockedAt, kickoffAt }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate ?? ''))) throw new Error('TARGET_DATE_REQUIRED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(maxEvidenceDate ?? ''))) throw new Error('MAX_EVIDENCE_DATE_REQUIRED');
  if (String(maxEvidenceDate) >= String(targetDate)) throw new Error('STRICT_PRIOR_FAILURE');
  const locked = Date.parse(String(lockedAt ?? ''));
  if (!Number.isFinite(locked)) throw new Error('LOCKED_AT_REQUIRED');
  if (kickoffAt != null) {
    const kickoff = Date.parse(String(kickoffAt));
    if (!Number.isFinite(kickoff)) throw new Error('INVALID_KICKOFF_AT');
    if (locked >= kickoff) throw new Error('PREDICTION_NOT_PREMATCH');
  }
  return true;
}

export function normalizeLockedPrediction(input = {}) {
  assertPreRegistration(input);
  const probabilities = input.probabilities ?? {};
  for (const market of ['3+ HT','7+ FT','Other HT','Other FT']) {
    const p = Number(probabilities[market]);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`INVALID_PROBABILITY:${market}`);
  }
  return Object.freeze({
    benchmarkVersion: LIVING_BENCHMARK_VERSION,
    modelName: String(input.modelName ?? ''),
    modelVersion: String(input.modelVersion ?? ''),
    modelFingerprint: String(input.modelFingerprint ?? ''),
    fixtureId: String(input.fixtureId ?? ''),
    targetDate: String(input.targetDate),
    kickoffAt: input.kickoffAt ?? null,
    lockedAt: String(input.lockedAt),
    maxEvidenceDate: String(input.maxEvidenceDate),
    probabilities: Object.freeze({ ...probabilities }),
    top3HT: Array.isArray(input.top3HT) ? [...input.top3HT] : [],
    top3FT: Array.isArray(input.top3FT) ? [...input.top3FT] : [],
    tailConditional: input.tailConditional ?? null,
    productionMutationAllowed: false,
  });
}

export function settleLockedPrediction(prediction, settlement) {
  if (!prediction || prediction.benchmarkVersion !== LIVING_BENCHMARK_VERSION) throw new Error('LOCKED_PREDICTION_REQUIRED');
  if (!settlement || typeof settlement !== 'object') throw new Error('SETTLEMENT_REQUIRED');
  if (!settlement.actualMarkets || typeof settlement.actualMarkets !== 'object') throw new Error('ACTUAL_MARKETS_REQUIRED');
  for (const market of ['3+ HT','7+ FT','Other HT','Other FT']) {
    if (![0,1].includes(settlement.actualMarkets[market])) throw new Error(`INVALID_ACTUAL:${market}`);
  }
  return Object.freeze({
    ...prediction,
    actualHT: settlement.actualHT ?? null,
    actualFT: settlement.actualFT ?? null,
    actualMarkets: Object.freeze({ ...settlement.actualMarkets }),
    settledAt: settlement.settledAt ?? new Date().toISOString(),
    sourceProvenance: settlement.sourceProvenance ?? {},
    status: 'SETTLED',
  });
}

export function prequentialBrier(settledRows = []) {
  const markets = ['3+ HT','7+ FT','Other HT','Other FT'];
  const rows = settledRows.filter(r => r?.status === 'SETTLED');
  if (!rows.length) return { n: 0, meanBrier: null, byMarket: {} };
  const byMarket = {};
  for (const market of markets) {
    const vals = rows.map(r => (Number(r.probabilities[market]) - Number(r.actualMarkets[market])) ** 2);
    byMarket[market] = vals.reduce((a,b) => a + b, 0) / vals.length;
  }
  const meanBrier = Object.values(byMarket).reduce((a,b) => a + b, 0) / markets.length;
  return { n: rows.length, meanBrier, byMarket };
}
