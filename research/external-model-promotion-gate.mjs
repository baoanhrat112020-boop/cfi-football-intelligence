import { evaluateRun } from './promotion-gate.mjs';
import { assessLeakageAdjustedGate } from './fusion/leakage-adjusted-gate.mjs';

export function evaluateExternalModelRun(rows,options={}){
  const base=evaluateRun(rows,options);
  const leakage=assessLeakageAdjustedGate(options.externalModelAudit??{});
  if(leakage.pass) return {...base,leakageAdjustedGate:leakage};
  const hardFailures=[...new Set([...(base.hardFailures??[]),leakage.reason])];
  return {...base,status:'FAIL_HARD_GATE',shadowEligible:false,productionEligible:false,hardFailures,leakageAdjustedGate:leakage};
}
