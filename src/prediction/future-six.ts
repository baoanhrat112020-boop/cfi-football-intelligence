import { MARKET_CODES, type CanonicalFixture, strictPriorEvidence } from "./final-engine.ts";

export const FUTURE_SIX_VERSION = "CFI_FUTURE_SIX_V0.1";
export const FUTURE_FACTOR_CODES = [
  "GOAL_TEMPO",
  "DOMINANCE",
  "COLLAPSE_RISK",
  "COMEBACK_SURGE",
  "VOLATILITY",
  "EXTREME_SCORE_PRESSURE",
] as const;

export type FutureFactorCode = typeof FUTURE_FACTOR_CODES[number];
export type FutureFactor = {
  code: FutureFactorCode;
  probability: number;
  sampleSize: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const variance = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
};
const confidence = (sampleSize: number): FutureFactor["confidence"] => sampleSize >= 30 ? "HIGH" : sampleSize >= 12 ? "MEDIUM" : "LOW";

function teamRows(team: string, fixtures: CanonicalFixture[]) {
  const key = team.toLowerCase();
  return fixtures
    .filter((row) => row.homeTeam.toLowerCase() === key || row.awayTeam.toLowerCase() === key)
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));
}

function goalsFor(row: CanonicalFixture, team: string, part: "ht" | "ft") {
  const score = row[part];
  if (!score) return null;
  return row.homeTeam.toLowerCase() === team.toLowerCase() ? score.home : score.away;
}

function goalsAgainst(row: CanonicalFixture, team: string, part: "ht" | "ft") {
  const score = row[part];
  if (!score) return null;
  return row.homeTeam.toLowerCase() === team.toLowerCase() ? score.away : score.home;
}

function compactNumbers(rows: Array<number | null>) { return rows.filter((value): value is number => value !== null); }

function summarizeTeam(team: string, fixtures: CanonicalFixture[]) {
  const rows = teamRows(team, fixtures);
  const gf = compactNumbers(rows.map((row) => goalsFor(row, team, "ft")));
  const ga = compactNumbers(rows.map((row) => goalsAgainst(row, team, "ft")));
  const htGf = compactNumbers(rows.map((row) => goalsFor(row, team, "ht")));
  const totals = rows.filter((row) => row.ft).map((row) => row.ft!.home + row.ft!.away);
  const htTotals = rows.filter((row) => row.ht).map((row) => row.ht!.home + row.ht!.away);
  const comebackEligible = rows.filter((row) => row.ht && row.ft && goalsFor(row, team, "ht")! < goalsAgainst(row, team, "ht")!);
  const comebackWins = comebackEligible.filter((row) => goalsFor(row, team, "ft")! >= goalsAgainst(row, team, "ft")!).length;
  return {
    rows: rows.length,
    gf,
    ga,
    htGf,
    totals,
    htTotals,
    avgGf: mean(gf),
    avgGa: mean(ga),
    avgHtGf: mean(htGf),
    highWins: gf.filter((value, index) => value - (ga[index] ?? 0) >= 3).length,
    collapseRate: ga.length ? ga.filter((value) => value >= 3).length / ga.length : 0,
    comebackRate: comebackEligible.length ? comebackWins / comebackEligible.length : 0,
    totalVariance: variance(totals),
    extremeRate: gf.length ? gf.filter((value) => value >= 5).length / gf.length : 0,
    sevenPlusRate: totals.length ? totals.filter((value) => value >= 7).length / totals.length : 0,
    threePlusHtRate: htTotals.length ? htTotals.filter((value) => value >= 3).length / htTotals.length : 0,
  };
}

function factor(code: FutureFactorCode, probability: number, sampleSize: number, evidence: string[]): FutureFactor {
  return { code, probability: clamp(probability), sampleSize, confidence: confidence(sampleSize), evidence };
}

export function buildFutureSixPrediction(args: {
  home: string;
  away: string;
  targetDate?: string;
  homePayload: unknown;
  awayPayload: unknown;
  h2hPayload: unknown;
}) {
  const prior = strictPriorEvidence(args.homePayload, args.awayPayload, args.h2hPayload, args.targetDate);
  const home = summarizeTeam(args.home, prior.unique);
  const away = summarizeTeam(args.away, prior.unique);
  const sampleSize = prior.unique.length;

  const goalTempo = clamp((home.avgHtGf + away.avgHtGf) / 3 + (home.threePlusHtRate + away.threePlusHtRate) * 0.2);
  const dominance = clamp(Math.abs((home.avgGf - home.avgGa) - (away.avgGf - away.avgGa)) / 4 + (home.highWins + away.highWins) / Math.max(1, sampleSize) * 0.35);
  const collapseRisk = clamp((home.collapseRate + away.collapseRate) / 2);
  const comebackSurge = clamp((home.comebackRate + away.comebackRate) / 2);
  const volatility = clamp((Math.sqrt(home.totalVariance) + Math.sqrt(away.totalVariance)) / 8);
  const extremePressure = clamp(
    0.22 * goalTempo +
    0.18 * dominance +
    0.2 * collapseRisk +
    0.12 * comebackSurge +
    0.16 * volatility +
    0.12 * ((home.extremeRate + away.extremeRate + home.sevenPlusRate + away.sevenPlusRate) / 4),
  );

  const factors = {
    GOAL_TEMPO: factor("GOAL_TEMPO", goalTempo, sampleSize, [`home_ht_gf:${home.avgHtGf.toFixed(3)}`, `away_ht_gf:${away.avgHtGf.toFixed(3)}`]),
    DOMINANCE: factor("DOMINANCE", dominance, sampleSize, [`home_gd_proxy:${(home.avgGf - home.avgGa).toFixed(3)}`, `away_gd_proxy:${(away.avgGf - away.avgGa).toFixed(3)}`]),
    COLLAPSE_RISK: factor("COLLAPSE_RISK", collapseRisk, sampleSize, [`home_collapse:${home.collapseRate.toFixed(3)}`, `away_collapse:${away.collapseRate.toFixed(3)}`]),
    COMEBACK_SURGE: factor("COMEBACK_SURGE", comebackSurge, sampleSize, [`home_comeback:${home.comebackRate.toFixed(3)}`, `away_comeback:${away.comebackRate.toFixed(3)}`]),
    VOLATILITY: factor("VOLATILITY", volatility, sampleSize, [`home_total_var:${home.totalVariance.toFixed(3)}`, `away_total_var:${away.totalVariance.toFixed(3)}`]),
    EXTREME_SCORE_PRESSURE: factor("EXTREME_SCORE_PRESSURE", extremePressure, sampleSize, [`home_extreme:${home.extremeRate.toFixed(3)}`, `away_extreme:${away.extremeRate.toFixed(3)}`]),
  } as const;

  const futureMarketSignals = {
    "3+ HT": clamp(0.72 * goalTempo + 0.16 * volatility + 0.12 * extremePressure),
    "7+ FT": clamp(0.34 * extremePressure + 0.24 * volatility + 0.2 * collapseRisk + 0.14 * dominance + 0.08 * comebackSurge),
    "Other HT": clamp(0.42 * dominance + 0.3 * goalTempo + 0.18 * collapseRisk + 0.1 * volatility),
    "Other FT": clamp(0.34 * dominance + 0.3 * extremePressure + 0.22 * collapseRisk + 0.14 * volatility),
  } satisfies Record<typeof MARKET_CODES[number], number>;

  return {
    model: "FUTURE_SIX_CHALLENGER",
    version: FUTURE_SIX_VERSION,
    status: sampleSize >= 12 ? "ACTIVE_CHALLENGER" : "LOW_SAMPLE_CHALLENGER",
    calibrated: false,
    promotable: false,
    evidence: prior.counts,
    factors,
    marketSignals: futureMarketSignals,
    note: "Challenger only: run in parallel; never overwrite frozen production prediction until settled out-of-sample gates pass.",
  };
}
