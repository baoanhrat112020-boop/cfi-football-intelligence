import { buildPrediction, FINAL_VERSION, MARKET_CODES, marketHit, normalizeFixtures, type CanonicalFixture } from "../prediction/final-engine.ts";

export const DUAL_REPLAY_VERSION = "CFI_DUAL_HISTORICAL_REPLAY_V0.2";
export const MODEL_TYPES = ["HISTORICAL_PRODUCTION", "FUTURE_SIX_FACTORS"] as const;
export type ModelType = typeof MODEL_TYPES[number];

type Eval = {
  replayKey: string;
  fixtureId: string;
  targetDate: string;
  homeTeam: string;
  awayTeam: string;
  modelType: ModelType;
  modelVersion: string;
  probabilities: Record<string, number>;
  outcomes: Record<string, 0 | 1 | null>;
  brier: Record<string, number | null>;
  top3HT: { status: "MODELED" | "NOT_YET_MODELED"; top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  top3FT: { status: "MODELED" | "NOT_YET_MODELED"; top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  factors?: unknown;
};

const key = (f: CanonicalFixture) => `${f.matchDate}|${f.homeTeam.toLowerCase()}|${f.awayTeam.toLowerCase()}`;
const score = (p: { home: number; away: number } | null) => p ? `${p.home}-${p.away}` : null;
const brier = (p: number, y: 0 | 1 | null) => y === null ? null : (p - y) ** 2;

function dedupeAndSort(fixtures: CanonicalFixture[]) {
  return [...new Map(fixtures.map((f) => [key(f), f])).values()]
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate) || key(a).localeCompare(key(b)));
}

function streams(prior: CanonicalFixture[], target: CanonicalFixture) {
  const homeKey = target.homeTeam.toLowerCase(), awayKey = target.awayTeam.toLowerCase();
  const involves = (f: CanonicalFixture, team: string) => f.homeTeam.toLowerCase() === team || f.awayTeam.toLowerCase() === team;
  return {
    homePayload: prior.filter((f) => involves(f, homeKey)),
    awayPayload: prior.filter((f) => involves(f, awayKey)),
    h2hPayload: prior.filter((f) => (f.homeTeam.toLowerCase() === homeKey && f.awayTeam.toLowerCase() === awayKey) || (f.homeTeam.toLowerCase() === awayKey && f.awayTeam.toLowerCase() === homeKey)),
  };
}

function top3Audit(candidates: Array<{ score: string; probability: number }> | undefined, actual: string | null) {
  if (!candidates || !actual) return { status: "MODELED" as const, top1Hit: actual ? false : null, top3Hit: actual ? false : null, rankOfHit: null };
  const rank = candidates.findIndex((x) => x.score === actual);
  return { status: "MODELED" as const, top1Hit: rank === 0, top3Hit: rank >= 0 && rank < 3, rankOfHit: rank >= 0 ? rank + 1 : null };
}

function summarize(rows: Eval[], modelType: ModelType) {
  const modelRows = rows.filter((r) => r.modelType === modelType);
  const markets = Object.fromEntries(MARKET_CODES.map((market) => {
    const eligible = modelRows.filter((r) => r.brier[market] !== null);
    const avg = eligible.length ? eligible.reduce((s, r) => s + (r.brier[market] ?? 0), 0) / eligible.length : null;
    const hits = eligible.filter((r) => {
      const y = r.outcomes[market];
      return y !== null && (r.probabilities[market] >= 0.5 ? 1 : 0) === y;
    }).length;
    return [market, { eligible: eligible.length, brier: avg, hitRate: eligible.length ? hits / eligible.length : null }];
  }));
  const ht = modelRows.filter((r) => r.top3HT.status === "MODELED" && r.top3HT.top3Hit !== null);
  const ft = modelRows.filter((r) => r.top3FT.status === "MODELED" && r.top3FT.top3Hit !== null);
  return {
    modelType,
    sampleCount: modelRows.length,
    markets,
    top3HTAccuracy: ht.length ? ht.filter((r) => r.top3HT.top3Hit).length / ht.length : null,
    top3FTAccuracy: ft.length ? ft.filter((r) => r.top3FT.top3Hit).length / ft.length : null,
  };
}

export function replayDualHistorical(input: unknown, options: { minPrior?: number } = {}) {
  const minPrior = Math.max(0, options.minPrior ?? 8);
  const fixtures = dedupeAndSort(normalizeFixtures(input));
  const evaluations: Eval[] = [];

  for (const target of fixtures) {
    const prior = fixtures.filter((f) => f.matchDate < target.matchDate);
    if (prior.length < minPrior) continue;
    const payloads = streams(prior, target);
    const prediction = buildPrediction({ home: target.homeTeam, away: target.awayTeam, targetDate: target.matchDate, language: "en", ...payloads });
    const outcomes = Object.fromEntries(MARKET_CODES.map((market) => {
      const y = marketHit(target, market);
      return [market, y === null ? null : y ? 1 : 0];
    })) as Record<string, 0 | 1 | null>;
    const prodProb = Object.fromEntries(MARKET_CODES.map((market) => [market, Number((prediction.markets[market] as any).methodA)]));
    const futureProb = Object.fromEntries(MARKET_CODES.map((market) => [market, Number((prediction.markets[market] as any).methodB)]));
    const actualHT = score(target.ht), actualFT = score(target.ft);
    const futureVersion = prediction.scoreline.futureSix.version;
    const baseKey = `${key(target)}|${DUAL_REPLAY_VERSION}`;

    evaluations.push({
      replayKey: `${baseKey}|HISTORICAL_PRODUCTION|${FINAL_VERSION}`,
      fixtureId: target.id, targetDate: target.matchDate, homeTeam: target.homeTeam, awayTeam: target.awayTeam,
      modelType: "HISTORICAL_PRODUCTION", modelVersion: FINAL_VERSION, probabilities: prodProb, outcomes,
      brier: Object.fromEntries(MARKET_CODES.map((m) => [m, brier(prodProb[m], outcomes[m])])),
      top3HT: top3Audit(prediction.scoreline.ht.methodA, actualHT), top3FT: top3Audit(prediction.scoreline.ft.methodA, actualFT),
    });
    evaluations.push({
      replayKey: `${baseKey}|FUTURE_SIX_FACTORS|${futureVersion}`,
      fixtureId: target.id, targetDate: target.matchDate, homeTeam: target.homeTeam, awayTeam: target.awayTeam,
      modelType: "FUTURE_SIX_FACTORS", modelVersion: futureVersion, probabilities: futureProb, outcomes,
      brier: Object.fromEntries(MARKET_CODES.map((m) => [m, brier(futureProb[m], outcomes[m])])),
      top3HT: top3Audit(prediction.scoreline.ht.methodB, actualHT),
      top3FT: top3Audit(prediction.scoreline.ft.methodB, actualFT),
      factors: prediction.scoreline.futureSix.factors,
    });
  }

  return {
    replayVersion: DUAL_REPLAY_VERSION,
    strictPrior: true,
    sameDateLeakage: false,
    canonicalFixtureMutations: 0,
    fixtureCount: fixtures.length,
    evaluatedFixtures: new Set(evaluations.map((r) => r.fixtureId)).size,
    evaluationRows: evaluations.length,
    evaluations,
    scoreboard: {
      historicalProduction: summarize(evaluations, "HISTORICAL_PRODUCTION"),
      futureSix: summarize(evaluations, "FUTURE_SIX_FACTORS"),
    },
  };
}
