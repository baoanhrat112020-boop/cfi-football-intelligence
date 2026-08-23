import { verifyLockedShadow, type LockedShadowSnapshot } from './multi-market-live-shadow.ts';

export type OosProbabilityVector=Record<string,number>;
export type SettledLockedOosRow={
  fixtureId:string;
  kickoffAt:string;
  settledAt:string;
  maxEvidenceDate:string;
  snapshot:LockedShadowSnapshot<{market:string;probabilities:OosProbabilityVector;baselineProbabilities:OosProbabilityVector}>;
  outcome:string;
  resultVerified:boolean;
  reconstructed?:boolean;
  predictionHistoryReplay?:boolean;
};
export type LockedOosGateOptions={minSample?:number;maxBrierRegression?:number};

const ts=(x:string)=>{const n=Date.parse(x);return Number.isFinite(n)?n:null;};
const day=(x:string)=>String(x??'').slice(0,10);
function validateVector(p:OosProbabilityVector){
 const keys=Object.keys(p).sort();
 if(keys.length<2)return false;
 const vals=keys.map(k=>p[k]);
 return vals.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(vals.reduce((a,b)=>a+b,0)-1)<=1e-8;
}
function sameKeys(a:OosProbabilityVector,b:OosProbabilityVector){return JSON.stringify(Object.keys(a).sort())===JSON.stringify(Object.keys(b).sort());}
function brier(p:OosProbabilityVector,y:string){const keys=Object.keys(p);return keys.reduce((s,k)=>s+(p[k]-(k===y?1:0))**2,0)/keys.length;}
function logLoss(p:OosProbabilityVector,y:string){return -Math.log(Math.max(1e-12,p[y]??0));}

export function evaluateLockedOosGate(rows:SettledLockedOosRow[],options:LockedOosGateOptions={}){
 const minSample=Math.max(1,Math.floor(options.minSample??30));
 const maxBrierRegression=Number(options.maxBrierRegression??0);
 const failures:string[]=[];
 const seen=new Set<string>();
 const accepted:Array<{fixtureId:string;market:string;candidateBrier:number;baselineBrier:number;candidateLogLoss:number;baselineLogLoss:number}>=[];
 for(const r of rows){
  const reasons:string[]=[];
  const kickoff=ts(r.kickoffAt),created=ts(r.snapshot?.createdAt),settled=ts(r.settledAt);
  if(!r.fixtureId||r.fixtureId!==r.snapshot?.fixtureId)reasons.push('FIXTURE_ID_MISMATCH');
  if(seen.has(r.fixtureId))reasons.push('DUPLICATE_FIXTURE');else seen.add(r.fixtureId);
  if(!verifyLockedShadow(r.snapshot))reasons.push('LOCK_FINGERPRINT_INVALID');
  if(kickoff===null||created===null||created>=kickoff)reasons.push('SNAPSHOT_NOT_PREKICKOFF');
  if(settled===null||kickoff===null||settled<=kickoff)reasons.push('SETTLEMENT_NOT_POSTKICKOFF');
  if(!r.resultVerified)reasons.push('RESULT_NOT_VERIFIED');
  if(r.reconstructed)reasons.push('RECONSTRUCTED_PREDICTION_FORBIDDEN');
  if(r.predictionHistoryReplay)reasons.push('PREDICTION_HISTORY_REPLAY_FORBIDDEN');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day(r.maxEvidenceDate))||day(r.maxEvidenceDate)>=r.snapshot.targetDate)reasons.push('STRICT_PRIOR_FAILURE');
  const cp=r.snapshot?.payload?.probabilities??{},bp=r.snapshot?.payload?.baselineProbabilities??{};
  if(!validateVector(cp)||!validateVector(bp)||!sameKeys(cp,bp))reasons.push('PROBABILITY_VECTOR_INVALID');
  if(!Object.prototype.hasOwnProperty.call(cp,r.outcome))reasons.push('OUTCOME_NOT_IN_SUPPORT');
  if(reasons.length){failures.push(...reasons.map(x=>`${r.fixtureId||'UNKNOWN'}:${x}`));continue;}
  accepted.push({fixtureId:r.fixtureId,market:r.snapshot.payload.market,candidateBrier:brier(cp,r.outcome),baselineBrier:brier(bp,r.outcome),candidateLogLoss:logLoss(cp,r.outcome),baselineLogLoss:logLoss(bp,r.outcome)});
 }
 const avg=(k:keyof typeof accepted[number])=>accepted.length?accepted.reduce((s,r)=>s+Number(r[k]),0)/accepted.length:null;
 const candidateBrier=avg('candidateBrier'),baselineBrier=avg('baselineBrier'),candidateLogLoss=avg('candidateLogLoss'),baselineLogLoss=avg('baselineLogLoss');
 if(accepted.length<minSample)failures.push('INSUFFICIENT_LOCKED_OOS_SAMPLE');
 if(candidateBrier!==null&&baselineBrier!==null&&candidateBrier>baselineBrier+maxBrierRegression+1e-12)failures.push('LOCKED_OOS_BRIER_REGRESSION');
 return{
  version:'CFI_MULTI_MARKET_LOCKED_OOS_GATE_V1',
  status:failures.length?'BLOCKED':'PASS',
  baselineLock:'R0_IMMUTABLE',decisionUse:false,productionEligible:false,
  minSample,maxBrierRegression,inputRows:rows.length,acceptedRows:accepted.length,rejectedRows:rows.length-accepted.length,
  candidateBrier,baselineBrier,brierDelta:candidateBrier===null||baselineBrier===null?null:candidateBrier-baselineBrier,
  candidateLogLoss,baselineLogLoss,
  shadowTrialGatePassed:failures.length===0,
  hardFailures:[...new Set(failures)],
 };
}
