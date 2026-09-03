export const GROUP_A_SHADOW_LAB_POLICY_V1=Object.freeze({
  version:'CFI_GROUP_A_SHADOW_LAB_POLICY_V1',
  productionIndependent:true,
  productionBlocking:false,
  shadowLabOnly:true,
  researchOnly:true,
  decisionUse:false,
  productionMutationAllowed:false,
  productionEligible:false,
  noReconstruction:true,
  missingFrozenStatePolicy:'SKIP_NON_BLOCKING',
  missedKickoffPolicy:'SKIP_NO_RECONSTRUCTION',
  minPromotionSamples:30,
  maxShadowSamples:50,
  fullMultiMarketPassRequired:true,
  explicitProductionPromotionApprovalRequired:true,
});

const n=x=>Number(x);

export function evaluateGroupAShadowLabPolicy(input={}){
  const settledProspective=n(input.settledProspective??0);
  if(!Number.isSafeInteger(settledProspective)||settledProspective<0)throw new Error('GROUP_A_SHADOW_INVALID_SETTLED_SUPPORT');

  const common={
    version:GROUP_A_SHADOW_LAB_POLICY_V1.version,
    settledProspective,
    minPromotionSamples:GROUP_A_SHADOW_LAB_POLICY_V1.minPromotionSamples,
    maxShadowSamples:GROUP_A_SHADOW_LAB_POLICY_V1.maxShadowSamples,
    productionIndependent:true,
    productionBlocking:false,
    shadowLabOnly:true,
    researchOnly:true,
    decisionUse:false,
    productionMutationAllowed:false,
    productionEligible:false,
    noReconstruction:true,
    explicitProductionPromotionApprovalRequired:true,
  };

  if(input.frozenStateReady!==true){
    return {...common,status:'SKIP',reason:'MISSING_EXACT_FROZEN_STATE',action:'SKIP_NON_BLOCKING'};
  }
  if(input.fixturePreKickoff!==true){
    return {...common,status:'SKIP',reason:'MISSED_KICKOFF',action:'SKIP_NO_RECONSTRUCTION'};
  }
  if(settledProspective<GROUP_A_SHADOW_LAB_POLICY_V1.minPromotionSamples){
    return {...common,status:'CONTINUE_SHADOW',reason:'PROSPECTIVE_SUPPORT_BELOW_30',action:'ACCUMULATE_ONLY'};
  }

  const fullPass=input.fullMultiMarketPass===true;
  const clearImprovement=input.clearChampionImprovement===true;
  const hardRegression=input.hardRegression===true;

  if(hardRegression){
    return {...common,status:'RETIRE',reason:'HARD_REGRESSION_AFTER_MIN_SUPPORT',action:'CLOSE_CANDIDATE'};
  }
  if(fullPass&&clearImprovement){
    return {...common,status:'PROMOTION_REVIEW',reason:'MIN_SUPPORT_AND_FULL_MULTIMARKET_PASS',action:'REQUIRE_EXPLICIT_PRODUCTION_APPROVAL'};
  }
  if(settledProspective>=GROUP_A_SHADOW_LAB_POLICY_V1.maxShadowSamples){
    return {...common,status:'RETIRE',reason:'NO_CLEAR_CHAMPION_IMPROVEMENT_BY_50',action:'CLOSE_CANDIDATE'};
  }
  return {...common,status:'REVIEW',reason:'30_TO_49_WITHOUT_CLEAR_PROMOTION_CASE',action:'CONTINUE_SHADOW_OR_CLOSE'};
}
