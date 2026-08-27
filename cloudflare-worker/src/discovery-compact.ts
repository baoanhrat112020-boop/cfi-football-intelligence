function compactMultiMarket(value:any){
  if(!value)return null;
  return{version:value.version??null,status:value.status??null,decisionUse:value.decisionUse===true,source:value.source??null,championMutation:value.championMutation===true,consistencyGuard:value.consistencyGuard??null,crossCoreConsistency:value.crossCoreConsistency??null,k048Status:value.k048Status??null,reason:value.reason??null};
}

function compactChampionFusion(value:any){
  if(!value)return null;
  return{version:value.version??null,lineage:value.lineage??null,status:value.status??null,researchOnly:value.researchOnly!==false,decisionUse:value.decisionUse===true,productionEligible:value.productionEligible===true,activeExperts:value.activeExperts??[],candidateExperts:value.candidateExperts??{},gating:value.gating??null,uncertainty:value.uncertainty??null,champion:value.champion??null,oneXTwo:value?.multiMarket?.oneXTwo??null,consistencyGuard:value?.multiMarket?.consistencyGuard??null,reason:value.reason??null};
}

export function compactDiscoveryRow(row:any){
  const prediction=row?.prediction??{},output=prediction?.outputV2??{};
  return{
    match:row?.match??null,home:row?.home??null,away:row?.away??null,competition:row?.competition??null,country:row?.country??null,kickoff:row?.kickoff??null,kickoffLocal:row?.kickoffLocal??null,provider:row?.provider??null,fixtureProvenance:row?.fixtureProvenance??null,canonicalIdentity:row?.canonicalIdentity??null,inputMode:row?.inputMode??null,cohort:row?.cohort??null,bestMarket:row?.bestMarket??null,modelProbability:row?.modelProbability??null,fairOdds:row?.fairOdds??null,marketOdds:row?.marketOdds??null,edge:row?.edge??null,expectedValue:row?.expectedValue??null,selectionScore:row?.selectionScore??null,confidence:row?.confidence??null,status:row?.status??null,valueStatus:row?.valueStatus??null,strictPrior:row?.strictPrior===true,consistency:row?.consistency??null,multiMarketStatus:row?.multiMarketStatus??null,multiMarketDecisionUse:row?.multiMarketDecisionUse===true,marketSummary:row?.marketSummary??null,
    prediction:{status:prediction?.status??null,engine:prediction?.engine??null,target:prediction?.target??null,evidence:prediction?.evidence??null,temporalEvidenceAudit:prediction?.temporalEvidenceAudit??null,sixTargetMatrix:prediction?.sixTargetMatrix??null,presentationContract:prediction?.presentationContract??null,consistencyGuard:prediction?.consistencyGuard??null,multiMarketIntegration:compactMultiMarket(prediction?.multiMarketIntegration),championFusion:compactChampionFusion(prediction?.championFusion),multiMarketVisibility:output?.visibility??null,scoreline:output?.scoreline??null,expectedGoals:output?.expectedGoals??null,quality:output?.quality??null,rules:output?.rules??null}
  };
}
