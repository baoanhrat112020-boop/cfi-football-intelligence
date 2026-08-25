export const MULTI_MARKET_PROMOTION_V2='CFI_MULTI_MARKET_PROMOTION_GATE_V2';
export const MIN_PROMOTION_SAMPLE=30;

type Metric={n:number;brier:number|null;logLoss?:number|null;ece?:number|null};
type CandidateMetric={raw:Metric;calibrated:Metric;baseline:Metric;delta?:Record<string,number|null>};
export type PromotionInput={
  market:string;
  metric:CandidateMetric;
  strictPrior:boolean;
  temporalLeakage:boolean;
  coherenceStatus:'PASS'|'FAIL';
  deterministic:boolean;
  swapPass:boolean;
  collapsePass:boolean;
  segmentWorstBrierDelta?:number|null;
};

const finite=(x:unknown)=>Number.isFinite(Number(x));
export function evaluateMultiMarketPromotionV2(input:PromotionInput){
  const failures:string[]=[];
  const n=Number(input.metric?.calibrated?.n??0);
  const cb=input.metric?.calibrated?.brier,bb=input.metric?.baseline?.brier,rb=input.metric?.raw?.brier;
  if(!input.strictPrior)failures.push('STRICT_PRIOR_FAIL');
  if(input.temporalLeakage)failures.push('TEMPORAL_LEAKAGE');
  if(n<MIN_PROMOTION_SAMPLE)failures.push('INSUFFICIENT_SAMPLE');
  if(!finite(cb)||!finite(bb)||!finite(rb))failures.push('INVALID_BRIER');
  if(finite(cb)&&finite(bb)&&Number(cb)>Number(bb)+1e-12)failures.push('BRIER_WORSE_THAN_BASELINE');
  if(finite(cb)&&finite(rb)&&Number(cb)>Number(rb)+1e-12)failures.push('CALIBRATION_REGRESSION');
  if(input.coherenceStatus!=='PASS')failures.push('CROSS_MARKET_COHERENCE_FAIL');
  if(!input.deterministic)failures.push('NONDETERMINISTIC');
  if(!input.swapPass)failures.push('SWAP_FAIL');
  if(!input.collapsePass)failures.push('FORECAST_COLLAPSE_FAIL');
  if(finite(input.segmentWorstBrierDelta)&&Number(input.segmentWorstBrierDelta)>0.02)failures.push('SEGMENT_REGRESSION');
  const brierGain=finite(cb)&&finite(bb)?Math.max(-1,Math.min(1,Number(bb)-Number(cb))):0;
  const rawGain=finite(cb)&&finite(rb)?Math.max(-1,Math.min(1,Number(rb)-Number(cb))):0;
  const score=Math.max(0,Math.min(100,Math.round((70+Math.min(.15,Math.max(0,brierGain))*120+Math.min(.15,Math.max(0,rawGain))*80)*100)/100));
  return {version:MULTI_MARKET_PROMOTION_V2,market:input.market,n,score,hardFailures:failures,shadowEligible:failures.length===0&&score>=80,productionEligible:false,baselineLock:'R0_IMMUTABLE',decisionUse:false};
}
