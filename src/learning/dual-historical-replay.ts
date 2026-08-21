import { buildPrediction, FINAL_VERSION, MARKET_CODES, marketHit, normalizeFixtures, type CanonicalFixture } from "../prediction/final-engine.ts";

export const DUAL_REPLAY_VERSION = "CFI_DUAL_HISTORICAL_REPLAY_V0.4";
export const MODEL_TYPES = ["HISTORICAL_PRODUCTION", "FUTURE_SIX_FACTORS", "FINAL_CFI"] as const;
export type ModelType = typeof MODEL_TYPES[number];

type Eval = {
  replayKey: string;
  fixtureId: string;
  targetDate: string;
  homeTeam: string;
  awayTeam: string;
  modelType: ModelType;
  modelVersion: string;
  priorSample: number;
  probabilities: Record<string, number>;
  outcomes: Record<string, 0 | 1 | null>;
  brier: Record<string, number | null>;
  top3HT: { status: "MODELED" | "NOT_YET_MODELED"; top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  top3FT: { status: "MODELED" | "NOT_YET_MODELED"; top1Hit: boolean | null; top3Hit: boolean | null; rankOfHit: number | null };
  factors?: unknown;
};

const key = (f: CanonicalFixture) => `${f.matchDate}|${f.homeTeam.toLowerCase()}|${f.awayTeam.toLowerCase()}`;
const teamKey = (name: string) => name.toLowerCase();
const pairKey = (a: string, b: string) => [teamKey(a), teamKey(b)].sort().join("|");
const score = (p: { home: number; away: number } | null) => p ? `${p.home}-${p.away}` : null;
const brier = (p: number, y: 0 | 1 | null) => y === null ? null : (p - y) ** 2;

function dedupeAndSort(fixtures: CanonicalFixture[]) {
  return [...new Map(fixtures.map((f) => [key(f), f])).values()]
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate) || key(a).localeCompare(key(b)));
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
    top1HTAccuracy: ht.length ? ht.filter((r) => r.top3HT.top1Hit).length / ht.length : null,
    top1FTAccuracy: ft.length ? ft.filter((r) => r.top3FT.top1Hit).length / ft.length : null,
  };
}

function probabilities(prediction: any, field: "methodA" | "methodB" | "final") {
  return Object.fromEntries(MARKET_CODES.map((market) => [market, Number(prediction.markets[market]?.[field])]));
}

function pushEvaluation(args: {
  evaluations: Eval[];
  target: CanonicalFixture;
  modelType: ModelType;
  modelVersion: string;
  priorSample: number;
  probabilities: Record<string, number>;
  outcomes: Record<string, 0 | 1 | null>;
  top3HT?: Array<{ score: string; probability: number }>;
  top3FT?: Array<{ score: string; probability: number }>;
  actualHT: string | null;
  actualFT: string | null;
  factors?: unknown;
}) {
  const baseKey = `${key(args.target)}|${DUAL_REPLAY_VERSION}`;
  args.evaluations.push({
    replayKey: `${baseKey}|${args.modelType}|${args.modelVersion}`,
    fixtureId: args.target.id,
    targetDate: args.target.matchDate,
    homeTeam: args.target.homeTeam,
    awayTeam: args.target.awayTeam,
    modelType: args.modelType,
    modelVersion: args.modelVersion,
    priorSample: args.priorSample,
    probabilities: args.probabilities,
    outcomes: args.outcomes,
    brier: Object.fromEntries(MARKET_CODES.map((m) => [m, brier(args.probabilities[m], args.outcomes[m])])),
    top3HT: top3Audit(args.top3HT, args.actualHT),
    top3FT: top3Audit(args.top3FT, args.actualFT),
    ...(args.factors === undefined ? {} : { factors: args.factors }),
  });
}

/**
 * Strict-prior historical replay designed for large corpora.
 *
 * V0.4 retains the V0.3 date-batched incremental indexes and additionally
 * exposes the canonical strict-prior evidence count used for each target.
 * Histories are indexed incrementally by team and H2H pair. Fixtures on the
 * same date are evaluated as one batch and are only inserted into the prior
 * indexes AFTER the whole date has been evaluated, preserving sameDateLeakage=false.
 */
export function replayDualHistorical(input: unknown, options: { minPrior?: number } = {}) {
  const minPrior = Math.max(0, options.minPrior ?? 8);
  const fixtures = dedupeAndSort(normalizeFixtures(input));
  const evaluations: Eval[] = [];
  const teamPrior = new Map<string, CanonicalFixture[]>();
  const h2hPrior = new Map<string, CanonicalFixture[]>();
  let globalPriorCount = 0;

  for (let start = 0; start < fixtures.length;) {
    const date = fixtures[start].matchDate;
    let end = start + 1;
    while (end < fixtures.length && fixtures[end].matchDate === date) end++;
    const dateBatch = fixtures.slice(start, end);

    for (const target of dateBatch) {
      if (globalPriorCount < minPrior) continue;
      const homePayload = teamPrior.get(teamKey(target.homeTeam)) ?? [];
      const awayPayload = teamPrior.get(teamKey(target.awayTeam)) ?? [];
      const h2hPayload = h2hPrior.get(pairKey(target.homeTeam, target.awayTeam)) ?? [];
      const prediction = buildPrediction({
        home: target.homeTeam,
        away: target.awayTeam,
        targetDate: target.matchDate,
        language: "en",
        homePayload,
        awayPayload,
        h2hPayload,
      });
      const priorSample = Number(prediction?.evidence?.uniqueCanonical ?? 0);
      const outcomes = Object.fromEntries(MARKET_CODES.map((market) => {
        const y = marketHit(target, market);
        return [market, y === null ? null : y ? 1 : 0];
      })) as Record<string, 0 | 1 | null>;
      const actualHT = score(target.ht), actualFT = score(target.ft);
      const futureVersion = prediction.scoreline.futureSix.version;

      pushEvaluation({
        evaluations, target, modelType: "HISTORICAL_PRODUCTION", modelVersion: FINAL_VERSION, priorSample,
        probabilities: probabilities(prediction, "methodA"), outcomes,
        top3HT: prediction.scoreline.ht.methodA, top3FT: prediction.scoreline.ft.methodA,
        actualHT, actualFT,
      });
      pushEvaluation({
        evaluations, target, modelType: "FUTURE_SIX_FACTORS", modelVersion: futureVersion, priorSample,
        probabilities: probabilities(prediction, "methodB"), outcomes,
        top3HT: prediction.scoreline.ht.methodB, top3FT: prediction.scoreline.ft.methodB,
        actualHT, actualFT, factors: prediction.scoreline.futureSix.factors,
      });
      pushEvaluation({
        evaluations, target, modelType: "FINAL_CFI", modelVersion: FINAL_VERSION, priorSample,
        probabilities: probabilities(prediction, "final"), outcomes,
        top3HT: prediction.scoreline.ht.final, top3FT: prediction.scoreline.ft.final,
        actualHT, actualFT,
      });
    }

    for (const fixture of dateBatch) {
      for (const name of [fixture.homeTeam, fixture.awayTeam]) {
        const tk = teamKey(name);
        const rows = teamPrior.get(tk) ?? [];
        rows.push(fixture);
        teamPrior.set(tk, rows);
      }
      const pk = pairKey(fixture.homeTeam, fixture.awayTeam);
      const pairRows = h2hPrior.get(pk) ?? [];
      pairRows.push(fixture);
      h2hPrior.set(pk, pairRows);
    }
    globalPriorCount += dateBatch.length;
    start = end;
  }

  return {
    replayVersion: DUAL_REPLAY_VERSION,
    strictPrior: true,
    sameDateLeakage: false,
    canonicalFixtureMutations: 0,
    algorithm: "DATE_BATCHED_INCREMENTAL_INDEX",
    fixtureCount: fixtures.length,
    evaluatedFixtures: new Set(evaluations.map((r) => r.fixtureId)).size,
    evaluationRows: evaluations.length,
    evaluations,
    scoreboard: {
      historicalProduction: summarize(evaluations, "HISTORICAL_PRODUCTION"),
      futureSix: summarize(evaluations, "FUTURE_SIX_FACTORS"),
      finalCFI: summarize(evaluations, "FINAL_CFI"),
    },
  };
}
