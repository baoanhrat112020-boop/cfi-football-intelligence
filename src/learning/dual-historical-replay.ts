import { buildPrediction, FINAL_VERSION, MARKET_CODES, marketHit, normalizeFixtures, type CanonicalFixture } from "../prediction/final-engine.ts";
import { buildFutureSixPrediction, FUTURE_SIX_VERSION } from "../prediction/future-six.ts";

export const DUAL_REPLAY_VERSION = "CFI_DUAL_HISTORICAL_REPLAY_V1.0";
export const MODEL_TYPES = ["HISTORICAL_PRODUCTION", "FUTURE_SIX_FACTORS"] as const;
export const SCOREBOARD_WINDOWS = [25, 50, 100, 250, "ALL"] as const;
export const MIN_SCOREBOARD_SAMPLE = 25;
export type ModelType = typeof MODEL_TYPES[number];
export type MarketCode = typeof MARKET_CODES[number];

export type MarketEvaluation = {
  predictedProbability: number;
  actualBoolean: boolean | null;
  brier: number | null;
  hit: boolean | null;
  calibrationBin: string;
};

export type Top3Evaluation = {
  status: "MODELED" | "NOT_YET_MODELED";
  top1Hit: boolean | null;
  top3Hit: boolean | null;
  rankOfHit: number | null;
};

export type HistoricalEvaluation = {
  replayKey: string;
  replayVersion: string;
  fixtureId: string;
  targetDate: string;
  competitionId: string | null;
  segment: string;
  homeTeam: string;
  awayTeam: string;
  homeAwayContext: { home: string; away: string };
  modelType: ModelType;
  modelVersion: string;
  markets: Record<MarketCode, MarketEvaluation>;
  probabilities: Record<MarketCode, number>;
  outcomes: Record<MarketCode, 0 | 1 | null>;
  brier: Record<MarketCode, number | null>;
  top3HT: Top3Evaluation;
  top3FT: Top3Evaluation;
  factors?: unknown;
};

export type ReplayCursor = { matchDate: string; fixtureId: string };
export type FixturePage = { rows: unknown[]; nextCursor: ReplayCursor | null };
export type FixturePageSource = (cursor: ReplayCursor | null, limit: number) => Promise<FixturePage>;
export type EvaluationSink = (rows: Array<Record<string, unknown>>) => Promise<{ inserted: number }>;

const identityKey = (fixture: CanonicalFixture) =>
  `${fixture.matchDate}|${fixture.homeTeam.toLowerCase()}|${fixture.awayTeam.toLowerCase()}`;
const cursorKey = (fixture: CanonicalFixture) => `${fixture.matchDate}|${fixture.id}`;
const score = (pair: { home: number; away: number } | null) => pair ? `${pair.home}-${pair.away}` : null;
const brier = (probability: number, outcome: 0 | 1 | null) => outcome === null ? null : (probability - outcome) ** 2;
const calibrationBin = (probability: number) => {
  const lower = Math.min(90, Math.floor(Math.max(0, Math.min(0.999999, probability)) * 10) * 10);
  return `${lower}-${lower + 10}%`;
};

function canonicalize(fixtures: CanonicalFixture[]) {
  const byIdentity = new Map<string, CanonicalFixture>();
  for (const fixture of fixtures) {
    const key = identityKey(fixture);
    const existing = byIdentity.get(key);
    if (!existing || fixture.id.localeCompare(existing.id) < 0) byIdentity.set(key, fixture);
  }
  return [...byIdentity.values()].sort((a, b) =>
    a.matchDate.localeCompare(b.matchDate) || a.id.localeCompare(b.id) || identityKey(a).localeCompare(identityKey(b)));
}

function streams(prior: CanonicalFixture[], target: CanonicalFixture) {
  const homeKey = target.homeTeam.toLowerCase(), awayKey = target.awayTeam.toLowerCase();
  const involves = (fixture: CanonicalFixture, team: string) =>
    fixture.homeTeam.toLowerCase() === team || fixture.awayTeam.toLowerCase() === team;
  return {
    homePayload: prior.filter((fixture) => involves(fixture, homeKey)),
    awayPayload: prior.filter((fixture) => involves(fixture, awayKey)),
    h2hPayload: prior.filter((fixture) =>
      (fixture.homeTeam.toLowerCase() === homeKey && fixture.awayTeam.toLowerCase() === awayKey) ||
      (fixture.homeTeam.toLowerCase() === awayKey && fixture.awayTeam.toLowerCase() === homeKey)),
  };
}

const h2hKey = (home: string, away: string) => [home.toLowerCase(), away.toLowerCase()].sort().join("|");

function top3Audit(candidates: Array<{ score: string; probability: number }> | undefined, actual: string | null): Top3Evaluation {
  if (!actual) return { status: "MODELED", top1Hit: null, top3Hit: null, rankOfHit: null };
  const rank = candidates?.findIndex((candidate) => candidate.score === actual) ?? -1;
  return { status: "MODELED", top1Hit: rank === 0, top3Hit: rank >= 0 && rank < 3, rankOfHit: rank >= 0 ? rank + 1 : null };
}

function marketEvaluations(probabilities: Record<MarketCode, number>, target: CanonicalFixture) {
  return Object.fromEntries(MARKET_CODES.map((market) => {
    const actual = marketHit(target, market);
    const outcome: 0 | 1 | null = actual === null ? null : actual ? 1 : 0;
    const probability = probabilities[market];
    return [market, {
      predictedProbability: probability,
      actualBoolean: actual,
      brier: brier(probability, outcome),
      hit: actual === null ? null : (probability >= 0.5) === actual,
      calibrationBin: calibrationBin(probability),
    }];
  })) as Record<MarketCode, MarketEvaluation>;
}

function evaluation(
  target: CanonicalFixture,
  modelType: ModelType,
  modelVersion: string,
  probabilities: Record<MarketCode, number>,
  top3HT: Top3Evaluation,
  top3FT: Top3Evaluation,
  factors?: unknown,
): HistoricalEvaluation {
  const markets = marketEvaluations(probabilities, target);
  const outcomes = Object.fromEntries(MARKET_CODES.map((market) => {
    const actual = markets[market].actualBoolean;
    return [market, actual === null ? null : actual ? 1 : 0];
  })) as Record<MarketCode, 0 | 1 | null>;
  const losses = Object.fromEntries(MARKET_CODES.map((market) => [market, markets[market].brier])) as Record<MarketCode, number | null>;
  return {
    replayKey: `${target.id}|${modelType}|${modelVersion}|${DUAL_REPLAY_VERSION}`,
    replayVersion: DUAL_REPLAY_VERSION,
    fixtureId: target.id,
    targetDate: target.matchDate,
    competitionId: target.competitionId ?? null,
    segment: target.segment ?? "UNSEGMENTED",
    homeTeam: target.homeTeam,
    awayTeam: target.awayTeam,
    homeAwayContext: { home: target.homeTeam, away: target.awayTeam },
    modelType,
    modelVersion,
    markets,
    probabilities,
    outcomes,
    brier: losses,
    top3HT,
    top3FT,
    ...(factors === undefined ? {} : { factors }),
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function modelMetrics(rows: HistoricalEvaluation[], modelType: ModelType) {
  const selected = rows.filter((row) => row.modelType === modelType);
  const markets = Object.fromEntries(MARKET_CODES.map((market) => {
    const eligible = selected.filter((row) => row.markets[market].brier !== null);
    return [market, {
      sampleCount: eligible.length,
      brier: mean(eligible.map((row) => row.markets[market].brier!)),
      hitRate: mean(eligible.map((row) => row.markets[market].hit ? 1 : 0)),
      calibration: Object.fromEntries([...new Set(eligible.map((row) => row.markets[market].calibrationBin))].sort().map((bin) => {
        const binRows = eligible.filter((row) => row.markets[market].calibrationBin === bin);
        return [bin, {
          sampleCount: binRows.length,
          meanPredicted: mean(binRows.map((row) => row.markets[market].predictedProbability)),
          actualRate: mean(binRows.map((row) => row.markets[market].actualBoolean ? 1 : 0)),
        }];
      })),
    }];
  }));
  const ht = selected.filter((row) => row.top3HT.status === "MODELED" && row.top3HT.top3Hit !== null);
  const ft = selected.filter((row) => row.top3FT.status === "MODELED" && row.top3FT.top3Hit !== null);
  return {
    modelType,
    sampleCount: new Set(selected.map((row) => row.fixtureId)).size,
    markets,
    top3HTAccuracy: ht.length ? mean(ht.map((row) => row.top3HT.top3Hit ? 1 : 0)) : null,
    top3FTAccuracy: ft.length ? mean(ft.map((row) => row.top3FT.top3Hit ? 1 : 0)) : null,
  };
}

function pairedScore(rows: HistoricalEvaluation[], market: MarketCode) {
  const pairs = new Map<string, Partial<Record<ModelType, HistoricalEvaluation>>>();
  for (const row of rows) {
    if (row.markets[market].brier === null) continue;
    const pair = pairs.get(row.fixtureId) ?? {};
    pair[row.modelType] = row;
    pairs.set(row.fixtureId, pair);
  }
  const complete = [...pairs.values()].filter((pair) => pair.HISTORICAL_PRODUCTION && pair.FUTURE_SIX_FACTORS);
  const aBrier = mean(complete.map((pair) => pair.HISTORICAL_PRODUCTION!.markets[market].brier!));
  const bBrier = mean(complete.map((pair) => pair.FUTURE_SIX_FACTORS!.markets[market].brier!));
  const aHitRate = mean(complete.map((pair) => pair.HISTORICAL_PRODUCTION!.markets[market].hit ? 1 : 0));
  const bHitRate = mean(complete.map((pair) => pair.FUTURE_SIX_FACTORS!.markets[market].hit ? 1 : 0));
  return {
    modelABrier: aBrier,
    modelBBrier: bBrier,
    delta: aBrier === null || bBrier === null ? null : bBrier - aBrier,
    modelAHitRate: aHitRate,
    modelBHitRate: bHitRate,
    sampleCount: complete.length,
    winner: complete.length < MIN_SCOREBOARD_SAMPLE || aBrier === null || bBrier === null
      ? "INSUFFICIENT_SAMPLE"
      : aBrier === bBrier ? "TIE" : aBrier < bBrier ? "HISTORICAL_PRODUCTION" : "FUTURE_SIX_FACTORS",
  };
}

function windowed(rows: HistoricalEvaluation[]) {
  const fixtureDates = [...new Map(rows.map((row) => [row.fixtureId, row.targetDate])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  return Object.fromEntries(SCOREBOARD_WINDOWS.map((window) => {
    const ids = new Set((window === "ALL" ? fixtureDates : fixtureDates.slice(-window)).map(([id]) => id));
    const selected = rows.filter((row) => ids.has(row.fixtureId));
    return [String(window), Object.fromEntries(MARKET_CODES.map((market) => [market, pairedScore(selected, market)]))];
  }));
}

export function buildDualScoreboard(rows: HistoricalEvaluation[]) {
  const scopes: Record<string, HistoricalEvaluation[]> = { GLOBAL: rows };
  for (const row of rows) {
    if (row.competitionId) (scopes[`COMPETITION:${row.competitionId}`] ??= []).push(row);
    (scopes[`SEGMENT:${row.segment}`] ??= []).push(row);
    (scopes[`HOME:${row.homeTeam}`] ??= []).push(row);
    (scopes[`AWAY:${row.awayTeam}`] ??= []).push(row);
  }
  return Object.fromEntries(Object.entries(scopes).map(([scope, scopedRows]) => [scope, windowed(scopedRows)]));
}

export function replayDualHistorical(input: unknown, options: { minPrior?: number } = {}) {
  const minPrior = Math.max(0, options.minPrior ?? 8);
  const fixtures = canonicalize(normalizeFixtures(input));
  const evaluations: HistoricalEvaluation[] = [];
  const teamHistory = new Map<string, CanonicalFixture[]>();
  const h2hHistory = new Map<string, CanonicalFixture[]>();
  let priorCount = 0;

  for (let index = 0; index < fixtures.length;) {
    const targetDate = fixtures[index].matchDate;
    let end = index;
    while (end < fixtures.length && fixtures[end].matchDate === targetDate) end++;
    const sameDate = fixtures.slice(index, end);

    for (const target of sameDate) {
      if (priorCount < minPrior) continue;
      const payloads = {
        homePayload: teamHistory.get(target.homeTeam.toLowerCase()) ?? [],
        awayPayload: teamHistory.get(target.awayTeam.toLowerCase()) ?? [],
        h2hPayload: h2hHistory.get(h2hKey(target.homeTeam, target.awayTeam)) ?? [],
      };
      const production = buildPrediction({ home: target.homeTeam, away: target.awayTeam, targetDate, language: "en", ...payloads });
      const challenger = buildFutureSixPrediction({ home: target.homeTeam, away: target.awayTeam, targetDate, ...payloads });
      const productionProbabilities = Object.fromEntries(MARKET_CODES.map((market) =>
        [market, Number((production.markets[market] as { final: number }).final)])) as Record<MarketCode, number>;
      const challengerProbabilities = Object.fromEntries(MARKET_CODES.map((market) =>
        [market, Number(challenger.marketSignals[market])])) as Record<MarketCode, number>;

      evaluations.push(evaluation(
        target, "HISTORICAL_PRODUCTION", FINAL_VERSION, productionProbabilities,
        top3Audit(production.scoreline?.ht, score(target.ht)),
        top3Audit(production.scoreline?.ft, score(target.ft)),
      ));
      evaluations.push(evaluation(
        target, "FUTURE_SIX_FACTORS", FUTURE_SIX_VERSION, challengerProbabilities,
        { status: "NOT_YET_MODELED", top1Hit: null, top3Hit: null, rankOfHit: null },
        { status: "NOT_YET_MODELED", top1Hit: null, top3Hit: null, rankOfHit: null },
        challenger.factors,
      ));
    }
    for (const fixture of sameDate) {
      for (const team of [fixture.homeTeam.toLowerCase(), fixture.awayTeam.toLowerCase()]) {
        const history = teamHistory.get(team) ?? [];
        history.push(fixture);
        teamHistory.set(team, history);
      }
      const pair = h2hKey(fixture.homeTeam, fixture.awayTeam);
      const history = h2hHistory.get(pair) ?? [];
      history.push(fixture);
      h2hHistory.set(pair, history);
    }
    priorCount += sameDate.length;
    index = end;
  }

  const uniqueKeys = new Set(evaluations.map((row) => row.replayKey));
  if (uniqueKeys.size !== evaluations.length) throw new Error("DUPLICATE_REPLAY_KEY");
  return {
    replayVersion: DUAL_REPLAY_VERSION,
    strictPrior: true,
    sameDateLeakage: false,
    canonicalFixtureMutations: 0,
    fixtureCount: fixtures.length,
    evaluatedFixtures: new Set(evaluations.map((row) => row.fixtureId)).size,
    evaluationRows: evaluations.length,
    evaluations,
    learners: {
      historicalProduction: modelMetrics(evaluations, "HISTORICAL_PRODUCTION"),
      futureSix: modelMetrics(evaluations, "FUTURE_SIX_FACTORS"),
    },
    scoreboard: {
      historicalProduction: modelMetrics(evaluations, "HISTORICAL_PRODUCTION"),
      futureSix: modelMetrics(evaluations, "FUTURE_SIX_FACTORS"),
      scopes: buildDualScoreboard(evaluations),
    },
  };
}

export async function loadCanonicalCorpus(source: FixturePageSource, pageSize = 250) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("INVALID_PAGE_SIZE");
  const fixtures: CanonicalFixture[] = [];
  let cursor: ReplayCursor | null = null;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await source(cursor, pageSize);
    fixtures.push(...normalizeFixtures(page.rows));
    if (!page.nextCursor) break;
    const next = `${page.nextCursor.matchDate}|${page.nextCursor.fixtureId}`;
    const current = cursor ? `${cursor.matchDate}|${cursor.fixtureId}` : null;
    if (next === current || seenCursors.has(next)) throw new Error("NON_ADVANCING_CURSOR");
    seenCursors.add(next);
    cursor = page.nextCursor;
  }
  return canonicalize(fixtures);
}

export async function replayDualHistoricalFromSource(source: FixturePageSource, options: { pageSize?: number; minPrior?: number } = {}) {
  const fixtures = await loadCanonicalCorpus(source, options.pageSize ?? 250);
  return replayDualHistorical(fixtures, { minPrior: options.minPrior });
}

export function toPersistenceRow(row: HistoricalEvaluation) {
  return {
    fixture_id: row.fixtureId,
    model_type: row.modelType,
    model_version: row.modelVersion,
    replay_version: row.replayVersion,
    target_date: row.targetDate,
    competition_id: row.competitionId,
    segment: row.segment,
    home_team: row.homeTeam,
    away_team: row.awayTeam,
    market_evaluations: row.markets,
    top3_ht: row.top3HT,
    top3_ft: row.top3FT,
    factor_diagnostics: row.factors ?? null,
  };
}

export async function persistHistoricalEvaluations(rows: HistoricalEvaluation[], sink: EvaluationSink, batchSize = 500) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("INVALID_BATCH_SIZE");
  let inserted = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const result = await sink(rows.slice(index, index + batchSize).map(toPersistenceRow));
    inserted += result.inserted;
  }
  return { attempted: rows.length, inserted, duplicateCompatible: rows.length - inserted, canonicalFixtureMutations: 0 };
}

export function keysetPage(fixtures: CanonicalFixture[], cursor: ReplayCursor | null, limit: number): FixturePage {
  const sorted = [...fixtures].sort((a, b) => cursorKey(a).localeCompare(cursorKey(b)));
  const after = cursor ? sorted.filter((fixture) => cursorKey(fixture) > `${cursor.matchDate}|${cursor.fixtureId}`) : sorted;
  const selected = after.slice(0, limit);
  const last = selected.at(-1);
  return {
    rows: selected,
    nextCursor: selected.length === limit && last ? { matchDate: last.matchDate, fixtureId: last.id } : null,
  };
}
