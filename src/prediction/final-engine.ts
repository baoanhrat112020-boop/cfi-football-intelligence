export const FINAL_VERSION = "CFI_FINAL_V5.0.0";
export const MARKET_CODES = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;

export type Pair = { home: number; away: number };
export type CanonicalFixture = {
  id: string;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  ht: Pair | null;
  ft: Pair | null;
};

const finite = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function normalizePair(value: unknown): Pair | null {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
  }
  if (Array.isArray(value) && value.length >= 2) {
    const home = finite(value[0]), away = finite(value[1]);
    return home === null || away === null ? null : { home, away };
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const home = finite(row.home ?? row.h ?? row.homeGoals), away = finite(row.away ?? row.a ?? row.awayGoals);
    return home === null || away === null ? null : { home, away };
  }
  return null;
}

function unwrapRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["fixtures", "history", "rows", "data"]) {
    const value = row[key];
    if (Array.isArray(value)) return value;
    const nested = unwrapRows(value);
    if (nested.length) return nested;
  }
  for (const key of ["result", "body"]) {
    const nested = unwrapRows(row[key]);
    if (nested.length) return nested;
  }
  return [];
}

export function normalizeFixture(input: unknown): CanonicalFixture | null {
  if (!input || typeof input !== "object") return null;
  const outer = input as Record<string, unknown>;
  const row = (outer.fixture ?? outer.match ?? outer) as Record<string, unknown>;
  const matchDate = String(row.matchDate ?? row.match_date ?? row.date ?? "").slice(0, 10);
  const teamName = (value: unknown) => value && typeof value === "object" ? String((value as Record<string, unknown>).canonical_name ?? (value as Record<string, unknown>).name ?? "") : String(value ?? "");
  const homeTeam = teamName(row.homeTeam ?? row.home_team ?? row.home_name ?? row.home).trim();
  const awayTeam = teamName(row.awayTeam ?? row.away_team ?? row.away_name ?? row.away).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate) || !homeTeam || !awayTeam) return null;
  const ht = normalizePair(row.ht ?? row.htScore ?? row.ht_score ?? row.halfTime ?? row.half_time ?? row.halftimeScore) ??
    normalizePair([row.ht_home ?? row.hthg ?? row.home_ht, row.ht_away ?? row.htag ?? row.away_ht]);
  const ft = normalizePair(row.ft ?? row.ftScore ?? row.ft_score ?? row.fullTime ?? row.full_time ?? row.fulltimeScore) ??
    normalizePair([row.ft_home ?? row.fthg ?? row.home_ft, row.ft_away ?? row.ftag ?? row.away_ft]);
  if (ht && ft && (ht.home > ft.home || ht.away > ft.away)) return null;
  const identity = `${matchDate}|${homeTeam.toLowerCase()}|${awayTeam.toLowerCase()}`;
  return { id: String(row.fixture_id ?? row.fixtureId ?? row.id ?? identity), matchDate, homeTeam, awayTeam, ht, ft };
}

export function normalizeFixtures(payload: unknown) {
  return unwrapRows(payload).map(normalizeFixture).filter((fixture): fixture is CanonicalFixture => fixture !== null);
}

export function strictPriorEvidence(homePayload: unknown, awayPayload: unknown, h2hPayload: unknown, targetDate?: string) {
  const prior = (rows: CanonicalFixture[]) => rows.filter((row) => !targetDate || row.matchDate < targetDate);
  const home = prior(normalizeFixtures(homePayload));
  const away = prior(normalizeFixtures(awayPayload));
  const h2h = prior(normalizeFixtures(h2hPayload));
  const unique = [...new Map([...home, ...away, ...h2h].map((row) => [`${row.matchDate}|${row.homeTeam.toLowerCase()}|${row.awayTeam.toLowerCase()}`, row])).values()];
  return {
    streams: { home, away, h2h }, unique,
    counts: {
      homeFixtures: home.length, awayFixtures: away.length, h2hFixtures: h2h.length,
      uniqueCanonical: unique.length,
      htCoverage: unique.filter((row) => row.ht !== null).length,
      ftCoverage: unique.filter((row) => row.ft !== null).length,
    },
  };
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const weightedMean = (values: number[]) => {
  if (!values.length) return null;
  const weighted = values.map((value, index) => ({ value, weight: Math.pow(0.92, values.length - 1 - index) }));
  return weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weighted.reduce((sum, item) => sum + item.weight, 0);
};

export function marketHit(fixture: CanonicalFixture, market: typeof MARKET_CODES[number]) {
  if (market === "3+ HT") return fixture.ht ? fixture.ht.home + fixture.ht.away >= 3 : null;
  if (market === "7+ FT") return fixture.ft ? fixture.ft.home + fixture.ft.away >= 7 : null;
  if (market === "Other HT") return fixture.ht ? fixture.ht.home >= 4 || fixture.ht.away >= 4 : null;
  return fixture.ft ? fixture.ft.home >= 5 || fixture.ft.away >= 5 : null;
}

function teamDna(team: string, fixtures: CanonicalFixture[]) {
  const rows = fixtures.filter((row) => row.homeTeam.toLowerCase() === team.toLowerCase() || row.awayTeam.toLowerCase() === team.toLowerCase()).sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  const gf = rows.filter((row) => row.ft).map((row) => row.homeTeam.toLowerCase() === team.toLowerCase() ? row.ft!.home : row.ft!.away);
  const ga = rows.filter((row) => row.ft).map((row) => row.homeTeam.toLowerCase() === team.toLowerCase() ? row.ft!.away : row.ft!.home);
  const htGoals = rows.filter((row) => row.ht).map((row) => row.homeTeam.toLowerCase() === team.toLowerCase() ? row.ht!.home : row.ht!.away);
  const split = (venue: "home" | "away") => rows.filter((row) => venue === "home" ? row.homeTeam.toLowerCase() === team.toLowerCase() : row.awayTeam.toLowerCase() === team.toLowerCase());
  const recent = gf.slice(-5), previous = gf.slice(-10, -5);
  const streak = (predicate: (value: number) => boolean) => { let count = 0; for (const value of [...gf].reverse()) { if (!predicate(value)) break; count++; } return count; };
  return {
    fixtures: rows.length,
    recencyWeightedGF: weightedMean(gf), recencyWeightedGA: weightedMean(ga),
    htGoalMean: mean(htGoals), ftGoalMean: mean(gf),
    homeSplit: split("home").length, awaySplit: split("away").length,
    scoringStreak: streak((value) => value > 0), scorelessStreak: streak((value) => value === 0),
    highScoreCluster: gf.filter((value) => value >= 3).length,
    lowScoreCluster: gf.filter((value) => value <= 1).length,
    scoringAcceleration: recent.length && previous.length ? mean(recent)! - mean(previous)! : null,
    extremeScoreRecurrence: gf.filter((value) => value >= 5).length,
    goalTimingProfile: htGoals.length ? { firstHalfShare: htGoals.reduce((a, b) => a + b, 0) / Math.max(1, gf.reduce((a, b) => a + b, 0)) } : "unavailable",
    leadTrailBehavior: "unavailable",
    collapseRiskProxy: ga.length ? clamp(ga.filter((value) => value >= 3).length / ga.length) : null,
  };
}

function poisson(k: number, lambda: number) { let factorial = 1; for (let i = 2; i <= k; i++) factorial *= i; return Math.exp(-lambda) * Math.pow(lambda, k) / factorial; }
function scoreGrid(home: number, away: number, max: number) {
  const rows = [] as Array<{ score: string; probability: number; total: number }>;
  for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) rows.push({ score: `${h}-${a}`, probability: poisson(h, home) * poisson(a, away), total: h + a });
  const total = rows.reduce((sum, row) => sum + row.probability, 0) || 1;
  return rows.map((row) => ({ ...row, probability: row.probability / total }));
}

function structuralProbability(grid: Array<{ score: string; probability: number; total: number }>, market: typeof MARKET_CODES[number]) {
  return grid.filter((row) => {
    const [home, away] = row.score.split("-").map(Number);
    return market === "3+ HT" ? row.total >= 3 : market === "7+ FT" ? row.total >= 7 : market === "Other HT" ? home >= 4 || away >= 4 : home >= 5 || away >= 5;
  }).reduce((sum, row) => sum + row.probability, 0);
}

export function buildPrediction(args: { home: string; away: string; targetDate?: string; language?: string; homePayload: unknown; awayPayload: unknown; h2hPayload: unknown }) {
  const language = ["vi", "en", "zh", "th", "id"].includes(args.language ?? "") ? args.language! : "vi";
  const evidence = strictPriorEvidence(args.homePayload, args.awayPayload, args.h2hPayload, args.targetDate);
  const homeDna = teamDna(args.home, evidence.unique), awayDna = teamDna(args.away, evidence.unique);
  const homeHt = weightedMean(evidence.streams.home.filter((row) => row.ht).map((row) => row.ht!.home)) ?? 0.68;
  const awayHt = weightedMean(evidence.streams.away.filter((row) => row.ht).map((row) => row.ht!.away)) ?? 0.68;
  const homeFt = weightedMean(evidence.streams.home.filter((row) => row.ft).map((row) => row.ft!.home)) ?? 1.35;
  const awayFt = weightedMean(evidence.streams.away.filter((row) => row.ft).map((row) => row.ft!.away)) ?? 1.35;
  const htGrid = scoreGrid(clamp(homeHt, 0.08, 4.5), clamp(awayHt, 0.08, 4.5), 8);
  const ftGrid = scoreGrid(clamp(homeFt, 0.08, 6), clamp(awayFt, 0.08, 6), 12);
  const markets = Object.fromEntries(MARKET_CODES.map((market) => {
    const eligibleRows = evidence.unique.filter((row) => marketHit(row, market) !== null);
    const hits = eligibleRows.filter((row) => marketHit(row, market) === true).length;
    const rawRate = eligibleRows.length ? hits / eligibleRows.length : null;
    const smoothedRate = (hits + 1.5) / (eligibleRows.length + 7.5);
    const methodB = structuralProbability(market.includes("HT") ? htGrid : ftGrid, market);
    const completeness = Math.min(1, eligibleRows.length / 30);
    const disagreement = Math.abs(smoothedRate - methodB);
    const weightA = clamp(0.42 + 0.28 * completeness - 0.15 * disagreement, 0.35, 0.72);
    const final = clamp(smoothedRate * weightA + methodB * (1 - weightA));
    return [market, {
      methodA: smoothedRate, methodB, final,
      confidence: eligibleRows.length >= 30 && disagreement < 0.15 ? "HIGH" : eligibleRows.length >= 12 ? "MEDIUM" : "LOW",
      hits, eligible: eligibleRows.length, rawRate, smoothedRate,
      supportingFactors: [`eligible:${eligibleRows.length}`, `method_agreement:${(1 - disagreement).toFixed(3)}`],
      opposingFactors: eligibleRows.length < 12 ? ["SMALL_SAMPLE"] : disagreement > 0.25 ? ["MODEL_DISAGREEMENT"] : [],
      calibration: { version: "cfi-calibration-v1", weightA, weightB: 1 - weightA },
    }];
  }));
  const top = (grid: typeof htGrid) => [...grid].sort((a, b) => b.probability - a.probability).slice(0, 3).map(({ score, probability }) => ({ score, probability }));
  const ht = top(htGrid), ft = top(ftGrid);
  const warnings = [] as string[];
  if ((markets["3+ HT"] as any).final < 0.25 && htGrid.filter((row) => row.total >= 3).reduce((s, r) => s + r.probability, 0) > 0.45) warnings.push("HT_SCORELINE_MARKET_INCONSISTENCY");
  const maxFinal = Math.max(...Object.values(markets).map((market: any) => market.final));
  const ranking = Object.entries(markets).map(([market, value]: any) => ({ market, probability: value.final, confidence: value.confidence })).sort((a, b) => b.probability - a.probability);
  const verdict = maxFinal >= 0.6 ? "STRONG_SIGNAL" : "NO_STRONG_SIGNAL";
  const localizedVerdict = {
    vi: verdict === "STRONG_SIGNAL" ? "CÓ TÍN HIỆU MẠNH" : "CHƯA CÓ TÍN HIỆU MẠNH",
    en: verdict === "STRONG_SIGNAL" ? "STRONG SIGNAL" : "NO STRONG SIGNAL",
    zh: verdict === "STRONG_SIGNAL" ? "强信号" : "无强信号",
    th: verdict === "STRONG_SIGNAL" ? "สัญญาณชัดเจน" : "ไม่มีสัญญาณชัดเจน",
    id: verdict === "STRONG_SIGNAL" ? "SINYAL KUAT" : "TIDAK ADA SINYAL KUAT",
  }[language];
  return {
    status: evidence.unique.length ? "DATA_READY" : "INSUFFICIENT_DATA",
    engine: FINAL_VERSION, language,
    target: { home: args.home, away: args.away, date: args.targetDate ?? null },
    evidence: { ...evidence.counts, strictPrior: Boolean(args.targetDate) },
    teamTrendingDNA: { home: homeDna, away: awayDna },
    context: { standings: "unavailable", opponentStrength: "unavailable", restFatigue: "unavailable", lineupInjuries: "unavailable", tacticalTempo: "unavailable", liveMomentum: "unavailable", randomnessAllowance: 0.025 },
    markets,
    scoreline: {
      ht, ft,
      expectedGoals: { htHome: homeHt, htAway: awayHt, ftHome: homeFt, ftAway: awayFt },
      mostLikelyPath: `${ht[0]?.score ?? "—"} HT → ${ft[0]?.score ?? "—"} FT`,
      uncertainty: evidence.unique.length >= 30 ? "MEDIUM" : "HIGH",
      consistencyWarnings: warnings,
    },
    ranking,
    verdict,
    localized: { verdict: localizedVerdict, probabilityUnit: "0..1", unavailable: language === "vi" ? "không có dữ liệu" : "unavailable" },
  };
}

export function walkForwardBacktest(fixtures: CanonicalFixture[]) {
  const sorted = [...new Map(fixtures.map((row) => [`${row.matchDate}|${row.homeTeam}|${row.awayTeam}`, row])).values()].sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  const metrics = Object.fromEntries(MARKET_CODES.map((market) => [market, { outcomes: [] as number[], a: [] as number[], b: [] as number[], final: [] as number[] }]));
  for (let index = 8; index < sorted.length; index++) {
    const target = sorted[index];
    const prediction = buildPrediction({ home: target.homeTeam, away: target.awayTeam, targetDate: target.matchDate, homePayload: sorted.slice(0, index), awayPayload: [], h2hPayload: [], language: "en" });
    for (const market of MARKET_CODES) {
      const outcome = marketHit(target, market); if (outcome === null) continue;
      const row = metrics[market]; const model = prediction.markets[market] as any;
      row.outcomes.push(outcome ? 1 : 0); row.a.push(model.methodA); row.b.push(model.methodB); row.final.push(model.final);
    }
  }
  const brier = (predictions: number[], outcomes: number[]) => predictions.length ? predictions.reduce((sum, p, i) => sum + (p - outcomes[i]) ** 2, 0) / predictions.length : null;
  return {
    evaluatedMatches: Math.max(0, sorted.length - 8),
    markets: Object.fromEntries(MARKET_CODES.map((market) => { const row = metrics[market]; return [market, { eligible: row.outcomes.length, prevalence: mean(row.outcomes), brierMethodA: brier(row.a, row.outcomes), brierMethodB: brier(row.b, row.outcomes), brierFinal: brier(row.final, row.outcomes) }]; })),
    calibration: { method: "strict-prior-walk-forward", leakage: false, reliabilityBuckets: "available when bucket n >= 10" },
  };
}
