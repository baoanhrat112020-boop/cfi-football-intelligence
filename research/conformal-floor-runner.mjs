import { MARKETS, assertStrictPriorDate, clamp01 } from './fusion/contracts.mjs';
import { buildRccpInterval } from './fusion/rccp-uncertainty.mjs';

export const K031_CONFORMAL_FLOOR_VERSION='CFI_K031_CONFORMAL_FLOOR_V1';
export const K031_CONFORMAL_FLOOR_CONTRACT=Object.freeze({
  version:K031_CONFORMAL_FLOOR_VERSION,
  experimentCode:'K031-CONFORMAL-FLOOR',
  researchOnly:true,
  strictPriorRequired:true,
  baselineLock:'R0_IMMUTABLE',
  productionMutationAllowed:false,
  canonicalDbMutationAllowed:false,
  trainingFree:true,
  decisionUse:false,
  productionEligible:false,
});

const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x??''));
const finite01=x=>Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=1;

export function runK031ConformalFloor(input={}){
  const targetDate=String(input.targetDate??'');
  const maxEvidenceDate=String(input.maxEvidenceDate??'');
  assertStrictPriorDate(maxEvidenceDate,targetDate);
  const rows=Array.isArray(input.rows)?input.rows:[];
  const alpha=Number(input.alpha??0.10);
  const minPrior=Math.max(2,Math.floor(Number(input.minPrior??30)));
  if(!Number.isFinite(alpha)||alpha<=0||alpha>=1)throw new Error('K031_ALPHA_INVALID');
  const lastValues=input.lastValues??{};
  const markets={};
  for(const market of MARKETS){
    const p=Number(lastValues[market]);
    if(!finite01(p))throw new Error(`K031_LAST_VALUE_REQUIRED:${market}`);
    const prior=rows.filter(r=>r?.market===market&&validDate(r?.targetDate)&&String(r.targetDate)<targetDate&&Number.isFinite(Number(r?.residual))&&Number(r.residual)>=0);
    if(prior.length<minPrior)throw new Error(`K031_INSUFFICIENT_PRIOR_RESIDUALS:${market}`);
    const interval=buildRccpInterval({probability:p,residuals:prior,alpha});
    markets[market]={probability:clamp01(p),interval,priorCount:prior.length};
  }
  return {
    experimentCode:'K031-CONFORMAL-FLOOR',
    runnerVersion:K031_CONFORMAL_FLOOR_VERSION,
    contract:K031_CONFORMAL_FLOOR_CONTRACT,
    strictPrior:{verified:true,targetDate,maxEvidenceDate},
    baselineLock:'R0_IMMUTABLE',
    researchOnly:true,
    decisionUse:false,
    productionEligible:false,
    alpha,
    minPrior,
    markets,
  };
}
