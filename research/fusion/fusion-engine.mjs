import { FUSION_VERSION, FUSION_CONTRACT, DEFAULT_FUSION_POLICY, MARKETS, assertStrictPriorDate, assertExpertOutput, clamp01 } from './contracts.mjs';
import { assessCoverage } from './coverage-guard.mjs';
import { routeTarget, selectiveGate } from './target-router.mjs';
import { auditTailGrid } from './tail-conditional.mjs';

export async function buildFusionPrediction(args={}){
  const {
    targetDate,maxEvidenceDate,experts,context={},
    calibrate=async(_m,p)=>p,htGrid=[],ftGrid=[],modulePolicy={}
  }=args;
  const policy={...DEFAULT_FUSION_POLICY,...modulePolicy};
  assertStrictPriorDate(maxEvidenceDate,targetDate);
  for(const name of ['FUTURE_SIX','HISTORICAL','MATCH_DNA','REGIME']) assertExpertOutput(experts?.[name]);
  const coverage=assessCoverage(context);
  const probabilities={},routerAudit={};
  for(const market of MARKETS){
    const championP=experts.FUTURE_SIX.probabilities[market];
    const routed=policy.useTargetRouter?routeTarget({market,experts,coverage}):{expert:'FUTURE_SIX',probability:championP,reason:'ROUTER_DISABLED'};
    let raw=routed.probability;
    let gate={intervene:true,reason:'SELECTIVE_GATE_DISABLED'};
    if(policy.useSelectiveGate){
      gate=selectiveGate({championP,challengerP:routed.probability,challengerSupport:experts.MATCH_DNA.confidence?.localSample,coverage});
      raw=gate.intervene?routed.probability:championP;
    }
    if(policy.useCoverageFallback&&coverage.ood){
      raw=championP;
      gate={intervene:false,reason:'OOD_FALLBACK'};
    }
    const calibrated=policy.useTemporalCalibration?await calibrate(market,raw,{targetDate,maxEvidenceDate,coverage,routed,gate}):raw;
    if(!Number.isFinite(calibrated)||calibrated<0||calibrated>1) throw new Error(`INVALID_CALIBRATED_PROBABILITY:${market}`);
    probabilities[market]=clamp01(calibrated);
    routerAudit[market]={routed,gate,raw,final:probabilities[market]};
  }
  const tailAudit=auditTailGrid({probabilities,htGrid,ftGrid});
  const hardFailures=[];
  if(policy.enableTailConditional&&!tailAudit.pass) hardFailures.push('TAIL_PROBABILITY_GRID_MISMATCH');
  const result={
    engine:FUSION_VERSION,
    contract:FUSION_CONTRACT,
    modulePolicy:policy,
    status:hardFailures.length?'FUSION_CONSISTENCY_FAIL':'SUCCESS',
    probabilities,
    top3HT:policy.preserveFutureSixTop3&&Array.isArray(experts.FUTURE_SIX.top3HT)?experts.FUTURE_SIX.top3HT:[],
    top3FT:policy.preserveFutureSixTop3&&Array.isArray(experts.FUTURE_SIX.top3FT)?experts.FUTURE_SIX.top3FT:[],
    coverage,
    routerAudit,
    tailConditional:policy.enableTailConditional?tailAudit.tail:null,
    consistency:{pass:policy.enableTailConditional?tailAudit.pass:true,warnings:policy.enableTailConditional?tailAudit.warnings:[]},
    strictPrior:{verified:true,targetDate,maxEvidenceDate},
    hardFailures,
    productionEligible:false,
    shadowEligible:false,
  };
  return result;
}
