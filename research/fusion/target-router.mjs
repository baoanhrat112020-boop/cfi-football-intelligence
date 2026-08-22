import { MARKETS, assertExpertOutput, clamp01 } from './contracts.mjs';

export function routeTarget({market,experts,coverage}){
  if(!MARKETS.includes(market)) throw new Error(`UNKNOWN_MARKET:${market}`);
  for(const name of ['FUTURE_SIX','MATCH_DNA','REGIME']) assertExpertOutput(experts[name]);
  const fs=experts.FUTURE_SIX,dna=experts.MATCH_DNA,regime=experts.REGIME;
  if(coverage?.ood) return {expert:'FUTURE_SIX',probability:fs.probabilities[market],reason:'OOD_FALLBACK'};
  const localSample=Number(dna.confidence?.localSample??0),localCoverage=Number(dna.confidence?.coverage??0);
  if(localSample>=80&&localCoverage>=.70) return {expert:'REGIME',probability:regime.probabilities[market],reason:'DNA_REGIME_SUPPORTED'};
  if(localSample>=40&&localCoverage>=.55) return {expert:'MATCH_DNA',probability:dna.probabilities[market],reason:'DNA_SUPPORTED'};
  return {expert:'FUTURE_SIX',probability:fs.probabilities[market],reason:'DEFAULT_STRONG_EXPERT'};
}

export function selectiveGate({championP,challengerP,challengerSupport,coverage}){
  if(!Number.isFinite(championP)||!Number.isFinite(challengerP)) return {intervene:false,reason:'INVALID_PROBABILITY'};
  if(coverage?.ood) return {intervene:false,reason:'OOD_NO_AGGRESSIVE_OVERRIDE'};
  if(Number(challengerSupport??0)<40) return {intervene:false,reason:'INSUFFICIENT_LOCAL_SUPPORT'};
  if(Math.abs(championP-challengerP)<.025) return {intervene:false,reason:'NO_MEANINGFUL_DELTA'};
  return {intervene:true,reason:'SUPPORTED_DIFFERENCE',disagreement:Math.abs(championP-challengerP)};
}

export function applyRegimeShrinkage({baseProbability,regimeRate,regimeSample}){
  if(!Number.isFinite(regimeRate)||Number(regimeSample)<20) return clamp01(baseProbability);
  const reliability=Math.min(1,Number(regimeSample)/250);
  const weight=.05+.20*reliability;
  return clamp01(baseProbability*(1-weight)+regimeRate*weight);
}
