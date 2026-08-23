import { buildMultiMarketV1, MULTI_MARKET_VERSION } from './multi-market-v1.ts';

const finiteNonNegative=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;

export function attachMultiMarketShadow(body:any){
  const e=body?.scoreline?.expectedGoals;
  const htHome=finiteNonNegative(e?.htHome),htAway=finiteNonNegative(e?.htAway),ftHome=finiteNonNegative(e?.ftHome),ftAway=finiteNonNegative(e?.ftAway);
  const observable=[htHome,htAway,ftHome,ftAway].every(v=>v!==null);
  if(!observable){
    body.multiMarketIntegration={version:MULTI_MARKET_VERSION,status:'UNAVAILABLE',decisionUse:false,reason:'EXPECTED_GOALS_TELEMETRY_REQUIRED'};
    return body;
  }
  const multiMarket=buildMultiMarketV1({htHome:htHome!,htAway:htAway!,ftHome:ftHome!,ftAway:ftAway!});
  body.multiMarket=multiMarket;
  body.multiMarketIntegration={version:MULTI_MARKET_VERSION,status:multiMarket.consistencyGuard.status==='PASS'?'SHADOW_READY':'SHADOW_BLOCKED',decisionUse:false,source:'scoreline.expectedGoals',championMutation:false,consistencyGuard:multiMarket.consistencyGuard};
  return body;
}
