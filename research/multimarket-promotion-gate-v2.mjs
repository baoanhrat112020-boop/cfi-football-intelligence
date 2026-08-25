export const MULTIMARKET_PROMOTION_GATE_VERSION='CFI_MULTIMARKET_PROMOTION_SCORE_V2';
export const MULTIMARKET_PROMOTION_THRESHOLD=80;
export const MULTIMARKET_MIN_SAMPLES=30;
export const COMPONENT_WEIGHTS=Object.freeze({
  accuracyBrier:20,
  calibrationEce:15,
  rankingDiscrimination:15,
  crossMarketCoherence:10,
  temporalOotRobustness:15,
  segmentRegimeRobustness:10,
  determinismSwapDiversity:5,
  decisionUtilityMarketComparison:10,
});
const REQUIRED_BOOLEAN_GATES=Object.freeze(['strictPrior','temporalLeakage','validProbability','calibrationFloor','forecastCollapse','determinism','swap','crossMarketCoherence','noReconstruction','noHoldoutTuning']);
const clamp100=x=>Math.max(0,Math.min(100,Number.isFinite(Number(x))?Number(x):0));
export function evaluateMultiMarketPromotion(input={}){
  const components=input.components??{};
  const gates=input.gates??{};
  const hardFailures=[];
  for(const gate of REQUIRED_BOOLEAN_GATES)if(gates[gate]!==true)hardFailures.push(`GATE_${gate.toUpperCase()}_FAIL`);
  const sampleSupport=Number(input.sampleSupport??0);
  if(!Number.isSafeInteger(sampleSupport)||sampleSupport<MULTIMARKET_MIN_SAMPLES)hardFailures.push('INSUFFICIENT_SAMPLE_SUPPORT');
  if(input.externalPretrained===true&&input.matchedCleanControl!==true&&input.prospectiveUnseenEvidence!==true)hardFailures.push('K017_MATCHED_CLEAN_OR_PROSPECTIVE_REQUIRED');
  let score=0;
  const normalized={};
  for(const [key,weight] of Object.entries(COMPONENT_WEIGHTS)){const value=clamp100(components[key]);normalized[key]=value;score+=value*weight/100;}
  score=Math.round(score*100)/100;
  const shadowEligible=hardFailures.length===0&&score>=MULTIMARKET_PROMOTION_THRESHOLD;
  return {version:MULTIMARKET_PROMOTION_GATE_VERSION,status:hardFailures.length?'FAIL_HARD_GATE':shadowEligible?'SHADOW_ELIGIBLE':'RESEARCH_ONLY',score,threshold:MULTIMARKET_PROMOTION_THRESHOLD,sampleSupport,minSamples:MULTIMARKET_MIN_SAMPLES,components:normalized,hardFailures,shadowEligible,productionEligible:false,productionPromotionRequired:true,baselineLock:'R0_IMMUTABLE'};
}
