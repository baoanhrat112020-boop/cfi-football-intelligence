import type { HistoricalFixture, PredictionInput } from './ensemble.ts';

export type ScorelineCandidate = { score: string; probability: number };
export type ScorelineForecast = {
  ht: ScorelineCandidate[];
  ft: ScorelineCandidate[];
  mostLikelyPath: string;
  spread: { htTop1: number; ftTop1: number; htEntropy: number; ftEntropy: number; uncertainty: 'LOW'|'MEDIUM'|'HIGH' };
};

const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));

function prior(rows: HistoricalFixture[], targetDate:string){
  return rows.filter(r=>r.matchDate<targetDate).filter(r=>[r.htHome,r.htAway,r.ftHome,r.ftAway].every(Number.isInteger));
}
function mean(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function poisson(k:number,l:number){let f=1;for(let i=2;i<=k;i++)f*=i;return Math.exp(-l)*Math.pow(l,k)/f;}
function entropy(ps:number[]){return -ps.reduce((s,p)=>p>0?s+p*Math.log2(p):s,0);}
function topScores(lh:number,la:number,maxGoals=7):ScorelineCandidate[]{
  const all:ScorelineCandidate[]=[];
  for(let h=0;h<=maxGoals;h++) for(let a=0;a<=maxGoals;a++) all.push({score:`${h}-${a}`,probability:poisson(h,lh)*poisson(a,la)});
  const total=all.reduce((s,x)=>s+x.probability,0)||1;
  return all.map(x=>({...x,probability:x.probability/total})).sort((a,b)=>b.probability-a.probability).slice(0,3);
}

/**
 * Structural scoreline distribution derived only from strict-prior canonical history.
 * HOME stream contributes attacking HOME values; AWAY stream contributes attacking AWAY values.
 * H2H is blended lightly when available. Missing history is shrunk toward conservative football priors.
 */
export function forecastScorelines(input:PredictionInput):ScorelineForecast{
  const home=prior(input.homeHistory,input.targetDate), away=prior(input.awayHistory,input.targetDate), h2h=prior(input.h2hHistory??[],input.targetDate);
  const priorHt=0.68, priorFt=1.35;
  const shrink=(sample:number[],p:number)=>{const n=sample.length,w=n/(n+8);return clamp(w*mean(sample)+(1-w)*p,0.08,4.5)};
  let htH=shrink(home.map(x=>x.htHome),priorHt), htA=shrink(away.map(x=>x.htAway),priorHt);
  let ftH=shrink(home.map(x=>x.ftHome),priorFt), ftA=shrink(away.map(x=>x.ftAway),priorFt);
  if(h2h.length){const wh=Math.min(.22,h2h.length/25);htH=(1-wh)*htH+wh*mean(h2h.map(x=>x.htHome));htA=(1-wh)*htA+wh*mean(h2h.map(x=>x.htAway));ftH=(1-wh)*ftH+wh*mean(h2h.map(x=>x.ftHome));ftA=(1-wh)*ftA+wh*mean(h2h.map(x=>x.ftAway));}
  const ht=topScores(htH,htA,5), ft=topScores(ftH,ftA,8);
  const eHt=entropy(ht.map(x=>x.probability)), eFt=entropy(ft.map(x=>x.probability));
  const top=Math.max(ht[0]?.probability??0,ft[0]?.probability??0);
  const uncertainty=top>=.22?'LOW':top>=.14?'MEDIUM':'HIGH';
  return {ht,ft,mostLikelyPath:`HT ${ht[0]?.score??'—'} → FT ${ft[0]?.score??'—'}`,spread:{htTop1:ht[0]?.probability??0,ftTop1:ft[0]?.probability??0,htEntropy:eHt,ftEntropy:eFt,uncertainty}};
}

export function scorelineMarketConsistency(f:ScorelineForecast, markets:Record<string,number>){
  const ht3=markets['3+ HT'], ft7=markets['7+ FT'];
  const htTopTotals=f.ht.map(x=>x.score.split('-').map(Number).reduce((a,b)=>a+b,0));
  const ftTopTotals=f.ft.map(x=>x.score.split('-').map(Number).reduce((a,b)=>a+b,0));
  const warnings:string[]=[];
  if(Number.isFinite(ht3)&&ht3>=.6&&htTopTotals.every(x=>x<3)) warnings.push('HT_SCORELINE_MARKET_INCONSISTENCY');
  if(Number.isFinite(ft7)&&ft7>=.45&&ftTopTotals.every(x=>x<7)) warnings.push('FT_SCORELINE_MARKET_INCONSISTENCY');
  return warnings;
}
