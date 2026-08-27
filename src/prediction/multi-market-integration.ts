import { buildIndependentScoreGrid, buildMultiMarketV1, MULTI_MARKET_VERSION } from './multi-market-v1.ts';
import { buildK048TrajectoryEnsemble, K048_VERSION } from '../../research/trajectory-joint-forecast.mjs';

const finiteNonNegative=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const CROSS_CORE_EQUIVALENCE_GATE='CFI_CROSS_CORE_EQUIVALENCE_GATE_V1';
const EQUIVALENCE_TOLERANCE=0.01;
const K048_SHADOW_CONTRACT='CFI_K048_SHADOW_INTEGRATION_V1';
const K048_EXPECTED_SHADOW_FAILURES=new Set(['K048_INFEASIBLE_HT_SUPPORT','K048_INFEASIBLE_FT_SUPPORT','K048_IPF_ROW_ZERO','K048_IPF_COL_ZERO','K048_MARGINAL_PRESERVATION_FAIL']);

export function isExpectedK048ShadowFailure(error:unknown){return error instanceof Error&&K048_EXPECTED_SHADOW_FAILURES.has(error.message);}

function crossCoreEquivalence(body:any,multiMarket:any){
  const checks=[
    {event:'3+ HT ≡ HT O2.5',champion:finiteNonNegative(body?.markets?.['3+ HT']?.final),shadow:finiteNonNegative(multiMarket?.overUnder?.ht?.['2.5']?.over?.fullWin)},
    {event:'7+ FT ≡ FT O6.5',champion:finiteNonNegative(body?.markets?.['7+ FT']?.final),shadow:finiteNonNegative(multiMarket?.overUnder?.ft?.['6.5']?.over?.fullWin)},
  ].map(x=>{const observable=x.champion!==null&&x.shadow!==null;const delta=observable?Math.abs(x.champion!-x.shadow!):null;return {...x,delta,tolerance:EQUIVALENCE_TOLERANCE,status:!observable?'UNAVAILABLE':delta!<=EQUIVALENCE_TOLERANCE?'PASS':'FAIL'};});
  const observable=checks.every(x=>x.status!=='UNAVAILABLE');
  return {version:CROSS_CORE_EQUIVALENCE_GATE,status:!observable?'UNAVAILABLE':checks.every(x=>x.status==='PASS')?'PASS':'FAIL',tolerance:EQUIVALENCE_TOLERANCE,checks,policy:'EQUIVALENT_EVENTS_MUST_RECONCILE_BEFORE_PROMOTION'};
}

function outcome(score:string){const [h,a]=score.split('-').map(Number);return h>a?'HOME':h<a?'AWAY':'DRAW';}
function unavailableK048(body:any,reason:string){body.k048TrajectoryShadow={version:K048_VERSION,integrationVersion:K048_SHADOW_CONTRACT,status:'UNAVAILABLE',reason,researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',championMutation:false};}
function attachK048Shadow(body:any,input:{htHome:number;htAway:number;ftHome:number;ftAway:number}){
  const temporal=body?.bigDbRetrieval?.temporalAudit??body?.temporalEvidenceAudit??body?.strictPriorAudit?.evidence;
  const targetDate=String(body?.target?.date??temporal?.targetDate??'').slice(0,10),maxEvidenceDate=String(temporal?.maxEvidenceDate??temporal?.exactTeamMaxEvidenceDate??'').slice(0,10);
  if(temporal?.verified!==true||Number(temporal?.futureEvidenceCount)!==0||Number(temporal?.sameDateEvidenceCount)!==0||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!/^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)||maxEvidenceDate>=targetDate){unavailableK048(body,'STRICT_PRIOR_PROVENANCE_REQUIRED');return;}
  const htMarginal=buildIndependentScoreGrid(input.htHome,input.htAway,10).filter(r=>r.probability>0).map(r=>({score:`${r.home}-${r.away}`,probability:r.probability}));
  const ftMarginal=buildIndependentScoreGrid(input.ftHome,input.ftAway,14).filter(r=>r.probability>0).map(r=>({score:`${r.home}-${r.away}`,probability:r.probability}));
  let ensemble:any;try{ensemble=buildK048TrajectoryEnsemble({targetDate,maxEvidenceDate,htMarginal,ftMarginal});}catch(error){if(!isExpectedK048ShadowFailure(error))throw error;unavailableK048(body,(error as Error).message);return;}
  const transition:any={HOME:{HOME:0,DRAW:0,AWAY:0},DRAW:{HOME:0,DRAW:0,AWAY:0},AWAY:{HOME:0,DRAW:0,AWAY:0}};
  for(const t of ensemble.trajectories)transition[outcome(t.ht)][outcome(t.ft)]+=Number(t.probability);
  for(const from of Object.keys(transition))for(const to of Object.keys(transition[from]))transition[from][to]=Math.round(transition[from][to]*1e12)/1e12;
  body.k048TrajectoryShadow={version:K048_VERSION,integrationVersion:K048_SHADOW_CONTRACT,status:'SHADOW_ELIGIBLE_ACTIVE',researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',promotionEvidence:{score:100,threshold:80,runRef:'K048-HISTORICAL-OOS-2026-V1'},strictPrior:ensemble.strictPrior,marginalAudit:ensemble.marginalAudit,trajectoryCount:ensemble.trajectoryCount,topTrajectories:ensemble.trajectories.slice(0,12),htToFtOutcomeTransition:transition,championMutation:false};
}

export function attachMultiMarketShadow(body:any){
  const e=body?.scoreline?.expectedGoals,htHome=finiteNonNegative(e?.htHome),htAway=finiteNonNegative(e?.htAway),ftHome=finiteNonNegative(e?.ftHome),ftAway=finiteNonNegative(e?.ftAway),observable=[htHome,htAway,ftHome,ftAway].every(v=>v!==null);
  const nativeSingleCore=body?.multiMarket?.version===MULTI_MARKET_VERSION&&body?.multiMarket?.model?.source==='FINAL_CALIBRATED_SCORE_DISTRIBUTION';
  if(!nativeSingleCore&&!observable){body.multiMarketIntegration={version:MULTI_MARKET_VERSION,status:'UNAVAILABLE',decisionUse:false,reason:'MULTI_MARKET_SOURCE_REQUIRED'};unavailableK048(body,'EXPECTED_GOALS_TELEMETRY_REQUIRED');return body;}
  const input=observable?{htHome:htHome!,htAway:htAway!,ftHome:ftHome!,ftAway:ftAway!}:null;
  const multiMarket=nativeSingleCore?body.multiMarket:buildMultiMarketV1(input!);
  const crossCoreConsistency=crossCoreEquivalence(body,multiMarket);
  body.multiMarket=multiMarket;
  if(input)attachK048Shadow(body,input);else unavailableK048(body,'EXPECTED_GOALS_TELEMETRY_REQUIRED');
  const internalPass=multiMarket.consistencyGuard.status==='PASS',crossCorePass=crossCoreConsistency.status==='PASS';
  body.multiMarketIntegration={version:MULTI_MARKET_VERSION,status:internalPass&&crossCorePass?'SHADOW_READY':'SHADOW_BLOCKED',decisionUse:false,source:nativeSingleCore?'FINAL_CALIBRATED_SCORE_DISTRIBUTION':'scoreline.expectedGoals',singleCore:nativeSingleCore,championMutation:false,consistencyGuard:multiMarket.consistencyGuard,crossCoreConsistency,k048Status:body?.k048TrajectoryShadow?.status??'UNAVAILABLE',...(!crossCorePass?{reason:'CROSS_CORE_EQUIVALENCE_FAIL'}:{})};
  return body;
}
