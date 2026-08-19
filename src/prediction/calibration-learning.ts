import { buildPrediction, marketHit, MARKET_CODES, type CanonicalFixture } from './final-engine.ts';

export const CALIBRATION_LEARNER_VERSION = 'CFI_CAL_LEARNER_V1.2';
export const PRIMARY_TARGET_CODES = [...MARKET_CODES, 'Top-3 HT', 'Top-3 FT'] as const;
const CANDIDATE_WEIGHT_A = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
const MIN_HISTORY_TO_SELECT = 20;
const MIN_SCORELINE_EVAL_TO_PROMOTE = 80;

const key = (x: CanonicalFixture) => `${x.matchDate}|${x.homeTeam.toLowerCase()}|${x.awayTeam.toLowerCase()}`;
const brier = (p: number, y: number) => (p - y) ** 2;
const mean = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const clamp = (x:number)=>Math.max(0,Math.min(1,x));

function streamsForTarget(prior: CanonicalFixture[], target: CanonicalFixture) {
  const homeKey = target.homeTeam.toLowerCase(), awayKey = target.awayTeam.toLowerCase();
  const involves = (row: CanonicalFixture, team: string) => row.homeTeam.toLowerCase() === team || row.awayTeam.toLowerCase() === team;
  return {
    home: prior.filter((row) => involves(row, homeKey)),
    away: prior.filter((row) => involves(row, awayKey)),
    h2h: prior.filter((row) => involves(row, homeKey) && involves(row, awayKey)),
  };
}

export function scorelineRank(candidates: Array<{score:string}> | null | undefined, actual: string) {
  if (!Array.isArray(candidates) || !actual) return null;
  const index = candidates.slice(0,3).findIndex((row)=>row?.score === actual);
  return index < 0 ? null : index + 1;
}

export type ReplayPoint = {
  targetKey: string;
  matchDate: string;
  market: typeof MARKET_CODES[number];
  outcome: number;
  methodA: number;
  methodB: number;
  baselineFinal: number;
  learnedFinal: number;
  selectedWeightA: number;
  selectionHistory: number;
};

export type ScorelineReplayPoint = {
  targetKey: string;
  matchDate: string;
  target: 'Top-3 HT' | 'Top-3 FT';
  actual: string;
  rankA: number | null;
  rankB: number | null;
  rankFinal: number | null;
  hit3A: boolean;
  hit3B: boolean;
  hit3Final: boolean;
};

export function strictPriorOnlineTournament(fixtures: CanonicalFixture[]) {
  const sorted = [...new Map(fixtures.map((row) => [key(row), row])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
  const candidateHistory = Object.fromEntries(MARKET_CODES.map((m)=>[m, new Map<number, number[]>(CANDIDATE_WEIGHT_A.map((w)=>[w, []]))])) as Record<typeof MARKET_CODES[number], Map<number, number[]>>;
  const points: ReplayPoint[] = [];
  const scorelinePoints: ScorelineReplayPoint[] = [];

  for (let index=0; index<sorted.length; index++) {
    const target = sorted[index];
    const prior = sorted.slice(0,index).filter((row)=>row.matchDate < target.matchDate);
    if (prior.length < 8) continue;
    const streams = streamsForTarget(prior,target);
    const prediction = buildPrediction({home:target.homeTeam, away:target.awayTeam, targetDate:target.matchDate, language:'en', homePayload:streams.home, awayPayload:streams.away, h2hPayload:streams.h2h});

    for (const market of MARKET_CODES) {
      const hit = marketHit(target,market); if (hit === null) continue;
      const outcome = hit ? 1 : 0;
      const row = prediction.markets[market] as any;
      const history = candidateHistory[market];
      const scored = [...history.entries()].map(([weightA, losses])=>({weightA, losses, score:mean(losses)}));
      const eligible = scored.filter((x)=>x.losses.length >= MIN_HISTORY_TO_SELECT && x.score !== null);
      const selected = eligible.length ? eligible.sort((a,b)=>(a.score! - b.score!) || Math.abs(a.weightA-0.5)-Math.abs(b.weightA-0.5))[0].weightA : row.calibration.weightA;
      const learned = clamp(row.methodA*selected + row.methodB*(1-selected));
      points.push({targetKey:key(target),matchDate:target.matchDate,market,outcome,methodA:row.methodA,methodB:row.methodB,baselineFinal:row.final,learnedFinal:learned,selectedWeightA:selected,selectionHistory:eligible.length ? history.get(selected)!.length : 0});
      for (const weightA of CANDIDATE_WEIGHT_A) {
        const p = clamp(row.methodA*weightA + row.methodB*(1-weightA));
        history.get(weightA)!.push(brier(p,outcome));
      }
    }

    if (target.ht) {
      const actual = `${target.ht.home}-${target.ht.away}`;
      const group = (prediction as any).scoreline?.ht;
      const rankA=scorelineRank(group?.methodA,actual), rankB=scorelineRank(group?.methodB,actual), rankFinal=scorelineRank(group?.final,actual);
      scorelinePoints.push({targetKey:key(target),matchDate:target.matchDate,target:'Top-3 HT',actual,rankA,rankB,rankFinal,hit3A:rankA!==null,hit3B:rankB!==null,hit3Final:rankFinal!==null});
    }
    if (target.ft) {
      const actual = `${target.ft.home}-${target.ft.away}`;
      const group = (prediction as any).scoreline?.ft;
      const rankA=scorelineRank(group?.methodA,actual), rankB=scorelineRank(group?.methodB,actual), rankFinal=scorelineRank(group?.final,actual);
      scorelinePoints.push({targetKey:key(target),matchDate:target.matchDate,target:'Top-3 FT',actual,rankA,rankB,rankFinal,hit3A:rankA!==null,hit3B:rankB!==null,hit3Final:rankFinal!==null});
    }
  }

  const markets = Object.fromEntries(MARKET_CODES.map((market)=>{
    const rows=points.filter((p)=>p.market===market);
    const baseline=rows.map((p)=>brier(p.baselineFinal,p.outcome));
    const learned=rows.map((p)=>brier(p.learnedFinal,p.outcome));
    const mature=rows.filter((p)=>p.selectionHistory>=MIN_HISTORY_TO_SELECT);
    return [market,{
      eligible:rows.length,
      matureEligible:mature.length,
      brierBaseline:mean(baseline),
      brierLearned:mean(learned),
      brierImprovement: baseline.length ? mean(baseline)!-mean(learned)! : null,
      meanSelectedWeightA:mean(mature.map((p)=>p.selectedWeightA)),
    }];
  }));

  const scorelines = Object.fromEntries((['Top-3 HT','Top-3 FT'] as const).map((targetCode)=>{
    const rows=scorelinePoints.filter((p)=>p.target===targetCode);
    const summarize=(rankKey:'rankA'|'rankB'|'rankFinal',hitKey:'hit3A'|'hit3B'|'hit3Final')=>({
      hitAt1:mean(rows.map((p)=>p[rankKey]===1?1:0)),
      hitAt3:mean(rows.map((p)=>p[hitKey]?1:0)),
      meanReciprocalRank:mean(rows.map((p)=>p[rankKey]?1/(p[rankKey] as number):0)),
      rank1:rows.filter((p)=>p[rankKey]===1).length,
      rank2:rows.filter((p)=>p[rankKey]===2).length,
      rank3:rows.filter((p)=>p[rankKey]===3).length,
      miss:rows.filter((p)=>p[rankKey]===null).length,
    });
    return [targetCode,{eligible:rows.length,methodA:summarize('rankA','hit3A'),methodB:summarize('rankB','hit3B'),final:summarize('rankFinal','hit3Final')}];
  }));

  const marketRows=Object.values(markets) as any[];
  const scorelineRows=Object.values(scorelines) as any[];
  const minMature=Math.min(...marketRows.map((m)=>m.matureEligible));
  const minScorelineEligible=Math.min(...scorelineRows.map((m)=>m.eligible));
  const avgImprovement=mean(marketRows.map((m)=>m.brierImprovement).filter((x):x is number=>x!==null));
  const maxDegradation=Math.max(...marketRows.map((m)=>m.brierImprovement===null?0:-m.brierImprovement));
  const promotion = {
    eligible: minMature >= 80 && minScorelineEligible >= MIN_SCORELINE_EVAL_TO_PROMOTE && (avgImprovement ?? -1) >= 0.002 && maxDegradation <= 0.005,
    reason: minMature < 80 ? 'INSUFFICIENT_OUT_OF_SAMPLE_REPLAY' : minScorelineEligible < MIN_SCORELINE_EVAL_TO_PROMOTE ? 'INSUFFICIENT_TOP3_REPLAY' : (avgImprovement ?? -1) < 0.002 ? 'NO_MEANINGFUL_BRIER_GAIN' : maxDegradation > 0.005 ? 'MARKET_REGRESSION' : 'PROMOTION_GATE_PASSED',
    minMaturePerMarket:minMature,
    minScorelineEligible,
    averageBrierImprovement:avgImprovement,
    maxMarketDegradation:maxDegradation,
    primaryTargets:[...PRIMARY_TARGET_CODES],
  };
  return {learner:CALIBRATION_LEARNER_VERSION,strictPrior:true,antiLeakage:'candidate selection for each pseudo-match uses losses from earlier pseudo-matches only',candidateWeightsA:[...CANDIDATE_WEIGHT_A],points,scorelinePoints,markets,scorelines,promotion};
}
