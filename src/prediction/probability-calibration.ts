export type MarketCalibrationInput={rawRate:number|null;structural:number;challenger:number;eligible:number;hits:number};
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));

/**
 * Conservative event calibration for rare/extreme football markets.
 * Structural score-grid mass is NOT treated as calibrated event probability.
 * The empirical event rate is the anchor; model distributions may move it only
 * within a sample-size-dependent envelope. This prevents sparse-grid smoothing
 * from manufacturing large tail probabilities.
 */
export function calibrateMarketProbability(x:MarketCalibrationInput){
  const empirical=x.rawRate??0;
  const reliability=clamp(x.eligible/60,0,1);
  const modelBlend=.5*x.structural+.5*x.challenger;
  const modelWeight=.15+.20*reliability;
  const unbounded=(1-modelWeight)*empirical+modelWeight*modelBlend;
  const maxLift=.04+.10*reliability;
  const lower=clamp(empirical-maxLift);
  const upper=clamp(empirical+maxLift);
  return clamp(unbounded,lower,upper);
}

export function sampleConfidence(n:number){return n>=30?'HIGH':n>=12?'MEDIUM':'LOW'}

/** Predictive confidence is deliberately separate from sample confidence. */
export function predictiveConfidence(p:number,rawRate:number|null,n:number){
  if(n<12||rawRate===null)return 'LOW';
  const gap=Math.abs(p-rawRate);
  if(n>=30&&gap<=.08)return 'MEDIUM';
  return 'LOW';
}
