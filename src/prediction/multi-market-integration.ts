import { buildMultiMarketV1, MULTI_MARKET_VERSION } from './multi-market-v1.ts';

const finiteNonNegative=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const CROSS_CORE_EQUIVALENCE_GATE='CFI_CROSS_CORE_EQUIVALENCE_GATE_V1';
const EQUIVALENCE_TOLERANCE=0.01;

function crossCoreEquivalence(body:any,multiMarket:any){
  const checks=[
    {event:'3+ HT ≡ HT O2.5',champion:finiteNonNegative(body?.markets?.['3+ HT']?.final),shadow:finiteNonNegative(multiMarket?.overUnder?.ht?.['2.5']?.over?.fullWin)},
    {event:'7+ FT ≡ FT O6.5',champion:finiteNonNegative(body?.markets?.['7+ FT']?.final),shadow:finiteNonNegative(multiMarket?.overUnder?.ft?.['6.5']?.over?.fullWin)},
  ].map(x=>{
    const observable=x.champion!==null&&x.shadow!==null;
    const delta=observable?Math.abs(x.champion!-x.shadow!):null;
    return {...x,delta,tolerance:EQUIVALENCE_TOLERANCE,status:!observable?'UNAVAILABLE':delta!<=EQUIVALENCE_TOLERANCE?'PASS':'FAIL'};
  });
  const observable=checks.every(x=>x.status!=='UNAVAILABLE');
  return {
    version:CROSS_CORE_EQUIVALENCE_GATE,
    status:!observable?'UNAVAILABLE':checks.every(x=>x.status==='PASS')?'PASS':'FAIL',
    tolerance:EQUIVALENCE_TOLERANCE,
    checks,
    policy:'EQUIVALENT_EVENTS_FROM_DIFFERENT_CORES_MUST_RECONCILE_BEFORE_PROMOTION',
  };
}

export function attachMultiMarketShadow(body:any){
  const e=body?.scoreline?.expectedGoals;
  const htHome=finiteNonNegative(e?.htHome),htAway=finiteNonNegative(e?.htAway),ftHome=finiteNonNegative(e?.ftHome),ftAway=finiteNonNegative(e?.ftAway);
  const observable=[htHome,htAway,ftHome,ftAway].every(v=>v!==null);
  if(!observable){
    body.multiMarketIntegration={version:MULTI_MARKET_VERSION,status:'UNAVAILABLE',decisionUse:false,reason:'EXPECTED_GOALS_TELEMETRY_REQUIRED'};
    return body;
  }
  const multiMarket=buildMultiMarketV1({htHome:htHome!,htAway:htAway!,ftHome:ftHome!,ftAway:ftAway!});
  const crossCoreConsistency=crossCoreEquivalence(body,multiMarket);
  body.multiMarket=multiMarket;
  const internalPass=multiMarket.consistencyGuard.status==='PASS';
  const crossCorePass=crossCoreConsistency.status==='PASS';
  body.multiMarketIntegration={
    version:MULTI_MARKET_VERSION,
    status:internalPass&&crossCorePass?'SHADOW_READY':'SHADOW_BLOCKED',
    decisionUse:false,
    source:'scoreline.expectedGoals',
    championMutation:false,
    consistencyGuard:multiMarket.consistencyGuard,
    crossCoreConsistency,
    ...(!crossCorePass?{reason:'CROSS_CORE_EQUIVALENCE_FAIL'}:{}),
  };
  return body;
}
