import { assertStrictPriorDate } from './fusion/contracts.mjs';
import { MULTIMARKET_RESEARCH_CONTRACT_VERSION } from './multimarket-promotion-gate-v2.mjs';

export const CONGESTION_TOTAL_INTENSITY_ONLY_V2='CFI_CONGESTION_TOTAL_INTENSITY_ONLY_V2';
export const CONGESTION_TOTAL_INTENSITY_CONTRACT=Object.freeze({
  version:CONGESTION_TOTAL_INTENSITY_ONLY_V2,
  multiMarketContractVersion:MULTIMARKET_RESEARCH_CONTRACT_VERSION,
  researchOnly:true,
  decisionUse:false,
  productionEligible:false,
  productionMutationAllowed:false,
  canonicalDbMutationAllowed:false,
  strictPriorRequired:true,
  reconstructedAllowed:false,
});

export const CONGESTION_PROVENANCE=Object.freeze([
  Object.freeze({source:'Frontiers Sports and Active Living',year:2024,doi:'10.3389/fspor.2023.1164454',finding:'48h recovery showed higher inflammation and muscle-damage markers than 72h recovery'}),
  Object.freeze({source:'British Journal of Sports Medicine / PubMed',year:2013,doi:'10.1136/bjsports-2013-092383',finding:'short recovery increased muscle-injury rates; team-performance effects were limited'}),
  Object.freeze({source:'PMC',year:2022,pmcid:'PMC8919880',finding:'congested periods reduced acceleration/deceleration activity, consistent with accumulated fatigue'}),
]);

export const EXPECTED_MULTIMARKET_EFFECT=Object.freeze({
  CHAMPION_6:'primarily total/high-score targets; directional targets should remain near baseline',
  SCORELINE_HT:'tail/mode mass may move through common HT intensity only',
  SCORELINE_FT:'tail/mode mass may move through common FT intensity only',
  '1X2_HT':'preserve directional share; regression is a hard concern',
  '1X2_FT':'preserve directional share; regression is a hard concern',
  OU_HT:'primary expected gain from total-intensity correction',
  OU_FT:'primary expected gain from total-intensity correction',
  AH_HT:'preserve goal-difference structure by holding home/away share fixed',
  AH_FT:'preserve goal-difference structure by holding home/away share fixed',
  CALIBRATION_UNCERTAINTY_ABSTENTION:'shrink effect to zero when schedule evidence is sparse or ambiguous',
  COHERENCE:'all markets must be derived from one adjusted joint score grid',
  DIRECTIONAL_SWAP:'must preserve swap symmetry',
  DETERMINISM:'same frozen inputs must produce identical output',
  SEGMENT_ROBUSTNESS:'evaluate by league/age/sex/competition-density segments',
});

const finitePositive=x=>Number.isFinite(Number(x))&&Number(x)>0;
const finiteNonNegative=x=>Number.isFinite(Number(x))&&Number(x)>=0;

export function buildCongestionSignal({targetDate,maxEvidenceDate,daysSincePreviousMatch,matchesPrior7d,matchesPrior14d,scheduleConfidence=1}={}){
  assertStrictPriorDate(maxEvidenceDate,targetDate);
  if(!finiteNonNegative(daysSincePreviousMatch)||!finiteNonNegative(matchesPrior7d)||!finiteNonNegative(matchesPrior14d))throw new Error('INVALID_CONGESTION_FEATURE');
  if(!Number.isFinite(Number(scheduleConfidence))||Number(scheduleConfidence)<0||Number(scheduleConfidence)>1)throw new Error('INVALID_SCHEDULE_CONFIDENCE');
  const restPressure=Math.max(0,4-Number(daysSincePreviousMatch))/4;
  const density7=Math.min(1,Math.max(0,Number(matchesPrior7d)-1)/2);
  const density14=Math.min(1,Math.max(0,Number(matchesPrior14d)-2)/3);
  const raw=(0.5*restPressure)+(0.3*density7)+(0.2*density14);
  return Number((raw*Number(scheduleConfidence)).toFixed(8));
}

export function applyCongestionTotalIntensityOnly({lambdaHome,lambdaAway,congestionSignal,frozenLogIntensityEffect}={}){
  if(!finitePositive(lambdaHome)||!finitePositive(lambdaAway))throw new Error('INVALID_BASELINE_LAMBDA');
  if(!Number.isFinite(Number(congestionSignal))||Number(congestionSignal)<0||Number(congestionSignal)>1)throw new Error('INVALID_CONGESTION_SIGNAL');
  if(!Number.isFinite(Number(frozenLogIntensityEffect))||Math.abs(Number(frozenLogIntensityEffect))>0.12)throw new Error('FROZEN_EFFECT_OUT_OF_BOUNDS');
  const total=Number(lambdaHome)+Number(lambdaAway);
  const share=Number(lambdaHome)/total;
  const logShift=Number(frozenLogIntensityEffect)*Number(congestionSignal);
  const adjustedTotal=total*Math.exp(logShift);
  const adjustedHome=share*adjustedTotal;
  const adjustedAway=(1-share)*adjustedTotal;
  return {
    version:CONGESTION_TOTAL_INTENSITY_ONLY_V2,
    contractVersion:MULTIMARKET_RESEARCH_CONTRACT_VERSION,
    researchOnly:true,
    decisionUse:false,
    productionEligible:false,
    baseline:{lambdaHome:Number(lambdaHome),lambdaAway:Number(lambdaAway),totalIntensity:total,directionalShare:share},
    congestion:{signal:Number(congestionSignal),frozenLogIntensityEffect:Number(frozenLogIntensityEffect),logShift},
    challenger:{lambdaHome:adjustedHome,lambdaAway:adjustedAway,totalIntensity:adjustedTotal,directionalShare:share},
    invariants:{directionalSharePreserved:Math.abs((adjustedHome/adjustedTotal)-share)<=1e-12,singleJointGridRequired:true},
  };
}
