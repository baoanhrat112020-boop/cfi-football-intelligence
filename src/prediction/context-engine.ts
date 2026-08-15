export type Market = "3+ HT" | "7+ FT" | "Other HT" | "Other FT";

export type FixtureEvidence = {
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  htHome: number | null;
  htAway: number | null;
  ftHome: number | null;
  ftAway: number | null;
};

export type TeamContext = {
  team: string;
  fixtures: FixtureEvidence[];
  homeAway?: "home" | "away";
  tablePosition?: number | null;
  tableSize?: number | null;
  lineupStrength?: number | null; // 0..1, 0.5 neutral
};

export type LiveContext = {
  minute: number;
  scoreHome: number;
  scoreAway: number;
  redCardTeam?: "home" | "away" | null;
};

export type ContextSignal = {
  trendScore: number;
  venueScore: number;
  tableScore: number;
  lineupScore: number;
  volatility: number;
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

function completed(f: FixtureEvidence) {
  return f.ftHome != null && f.ftAway != null && f.htHome != null && f.htAway != null;
}

function teamGoals(f: FixtureEvidence, team: string, phase: "ht" | "ft") {
  const isHome = f.homeTeam === team;
  const isAway = f.awayTeam === team;
  if (!isHome && !isAway) return null;
  if (phase === "ht") return isHome ? f.htHome : f.htAway;
  return isHome ? f.ftHome : f.ftAway;
}

function oppGoals(f: FixtureEvidence, team: string, phase: "ht" | "ft") {
  const isHome = f.homeTeam === team;
  const isAway = f.awayTeam === team;
  if (!isHome && !isAway) return null;
  if (phase === "ht") return isHome ? f.htAway : f.htHome;
  return isHome ? f.ftAway : f.ftHome;
}

export function buildScoreTrend(ctx: TeamContext) {
  const rows = ctx.fixtures.filter(completed).sort((a,b) => b.matchDate.localeCompare(a.matchDate));
  const recent = rows.slice(0, 12);
  const patterns = new Map<string, number>();
  recent.forEach((f, i) => {
    const gf = teamGoals(f, ctx.team, "ft")!;
    const ga = oppGoals(f, ctx.team, "ft")!;
    const key = `${gf}-${ga}`;
    const w = Math.exp(-i / 5);
    patterns.set(key, (patterns.get(key) ?? 0) + w);
  });
  const ranked = [...patterns.entries()].sort((a,b) => b[1]-a[1]).slice(0, 6);
  return ranked.map(([score, weight]) => ({ score, weight: Number(weight.toFixed(3)) }));
}

export function deriveContextSignal(ctx: TeamContext): ContextSignal {
  const rows = ctx.fixtures.filter(completed).sort((a,b) => b.matchDate.localeCompare(a.matchDate)).slice(0, 12);
  if (!rows.length) return { trendScore: 0.5, venueScore: 0.5, tableScore: 0.5, lineupScore: 0.5, volatility: 0.08 };

  let weightedGoals = 0, weightedConceded = 0, sumW = 0;
  let varianceSeed: number[] = [];
  rows.forEach((f,i) => {
    const w = Math.exp(-i/5);
    const gf = teamGoals(f, ctx.team, "ft")!;
    const ga = oppGoals(f, ctx.team, "ft")!;
    weightedGoals += gf*w;
    weightedConceded += ga*w;
    sumW += w;
    varianceSeed.push(gf+ga);
  });
  const gf = weightedGoals/sumW;
  const ga = weightedConceded/sumW;
  const trendScore = clamp((gf + 0.55*ga)/5);

  const venueRows = rows.filter(f => ctx.homeAway === "home" ? f.homeTeam === ctx.team : f.awayTeam === ctx.team);
  const venueAvg = venueRows.length ? venueRows.reduce((s,f)=>s+(teamGoals(f,ctx.team,"ft")! + oppGoals(f,ctx.team,"ft")!),0)/venueRows.length : gf+ga;
  const venueScore = clamp(venueAvg/5);

  let tableScore = 0.5;
  if (ctx.tablePosition && ctx.tableSize && ctx.tableSize > 1) tableScore = 1 - (ctx.tablePosition-1)/(ctx.tableSize-1);
  const lineupScore = clamp(ctx.lineupStrength ?? 0.5);

  const mean = varianceSeed.reduce((a,b)=>a+b,0)/varianceSeed.length;
  const variance = varianceSeed.reduce((s,x)=>s+(x-mean)**2,0)/varianceSeed.length;
  const volatility = clamp(0.04 + Math.sqrt(variance)/20, 0.04, 0.16);

  return { trendScore, venueScore, tableScore, lineupScore, volatility };
}

export function contextualAdjustment(signal: ContextSignal, market: Market) {
  const marketScale: Record<Market, number> = { "3+ HT": 0.10, "7+ FT": 0.13, "Other HT": 0.08, "Other FT": 0.11 };
  const base = 0.42*signal.trendScore + 0.26*signal.venueScore + 0.17*signal.lineupScore + 0.10*signal.tableScore + 0.05*0.5;
  const centered = base - 0.5;
  return { delta: centered * marketScale[market] * 2, uncertaintyFloor: signal.volatility };
}

export type RedCardHistory = {
  whenReduced: Array<{ minute: number; goalsAfterFor: number; goalsAfterAgainst: number; collapsed: boolean }>;
  opponentVsReduced: Array<{ minute: number; goalsAfterFor: number; aggressiveSurge: boolean }>;
};

export function analyzeRedCard(history: RedCardHistory, live: LiveContext) {
  if (!live.redCardTeam) return { alert: false, collapseRisk: 0, surgeRisk: 0, marketBoost: {} as Record<string,number> };
  const reduced = history.whenReduced;
  const opp = history.opponentVsReduced;
  const collapseRisk = reduced.length ? reduced.reduce((s,x)=>s+(x.collapsed?1:0),0)/reduced.length : 0.35;
  const surgeRisk = opp.length ? opp.reduce((s,x)=>s+(x.aggressiveSurge?1:0),0)/opp.length : 0.35;
  const timing = clamp((90-live.minute)/70,0.15,1);
  const combined = clamp((0.58*collapseRisk + 0.42*surgeRisk)*timing);
  return {
    alert: combined >= 0.42,
    collapseRisk,
    surgeRisk,
    marketBoost: {
      "3+ HT": live.minute <= 35 ? combined*0.09 : 0,
      "7+ FT": combined*0.16,
      "Other HT": live.minute <= 35 ? combined*0.07 : 0,
      "Other FT": combined*0.14,
    },
  };
}

export function applyContextToProbability(base: number, signal: ContextSignal, market: Market, randomShockWeight = 0.025) {
  const { delta, uncertaintyFloor } = contextualAdjustment(signal, market);
  const p = clamp(base + delta);
  return {
    probability: p,
    uncertaintyBand: [clamp(p-uncertaintyFloor-randomShockWeight), clamp(p+uncertaintyFloor+randomShockWeight)] as [number,number],
    randomShockWeight,
  };
}
