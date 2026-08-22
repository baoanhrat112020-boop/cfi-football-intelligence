import { FUSION_VERSION, FUSION_CONTRACT, MARKETS, assertStrictPriorDate, assertExpertOutput, clamp01 } from './contracts.mjs';
import { assessCoverage } from './coverage-guard.mjs';
import { routeTarget, selectiveGate } from './target-router.mjs';
import { auditTailGrid } from './tail-conditional.mjs';

export async function buildFusionPrediction(args={}){
  const {targetDate,maxEvidenceDate,experts,context={},calibrate=async(_m,p)=>p,htGrid=[],ftGrid=[]}=args;
  assertStrictPriorDate(maxEvidenceDate,targetDate);
  for(const name of ['FUTURE_SIX','HISTORICAL','MATCH_DNA','REGIME']) assertExpertOutput(experts?.[name]);
  const coverage=assessCoverage(context);
  const probabilities={},routerAudit={};
  for(const market of MARKETS){
    const routed=routeTarget({market,experts,coverage});
    const championP=experts.FUTURE_SIX.probabilities[market];
    const gate=selectiveGate({championP,challengerP:routed.probability,challengerSupport:experts.MATCH_DNA.confidence?.localSample,coverage});
    const raw=gate.intervene?routed.probability:championP;
    const calibrated=await calibrate(market,raw,{targetDate,maxEvidenceDate,coverage,routed,gate});
    if(!Number.isFinite(calibrated)||calibrated<0||calibrated>1) throw new Error(`INVALID_CALIBRATED_PROBABILITY:${market}`);
    probabilities[market]=clamp01(calibrated);
    routerAudit[market]={routed,gate,raw,final:probabilities[market]};
  }
  const tailAudit=auditTailGrid({probabilities,htGrid,ftGrid});
  const hardFailures=[];
  if(!tailAudit.pass) hardFailures.push('TAIL_PROBABILITY_GRID_MISMATCH');
  const result={
    engine:FUSION_VERSION,
    contract:FUSION_CONTRACT,
    status:hardFailures.length?'FUSION_CONSISTENCY_FAIL':'SUCCESS',
    probabilities,
    top3HT:Array.isArray(experts.FUTURE_SIX.top3HT)?experts.FUTURE_SIX.top3HT:[],
    top3FT:Array.isArray(experts.FUTURE_SIX.top3FT)?experts.FUTURE_SIX.top3FT:[],
    coverage,
    routerAudit,
    tailConditional:tailAudit.tail,
    consistency:{pass:tailAudit.pass,warnings:tailAudit.warnings},
    strictPrior:{verified:true,targetDate,maxEvidenceDate},
    hardFailures,
    productionEligible:false,
    shadowEligible:false,
  };
  return result;
}
