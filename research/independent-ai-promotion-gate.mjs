export const INDEPENDENT_AI_AUDIT_CONTRACT='CFI_INDEPENDENT_AI_AUDITOR_V1';

function blocked(reason,audit=null){
  return {
    contract:INDEPENDENT_AI_AUDIT_CONTRACT,
    status:'BLOCK_PROMOTION',
    pass:false,
    promotionAllowed:false,
    decisionUse:false,
    productionMutationAllowed:false,
    reason,
    audit,
  };
}

export function evaluateIndependentAiPromotionGate(audit){
  if(!audit || typeof audit!=='object') return blocked('INDEPENDENT_AI_AUDIT_REQUIRED');
  if(audit.contract!==INDEPENDENT_AI_AUDIT_CONTRACT) return blocked('INDEPENDENT_AI_AUDIT_CONTRACT_MISMATCH',audit);
  if(audit.decisionUse!==false || audit.productionMutationAllowed!==false) return blocked('INDEPENDENT_AI_AUDIT_ISOLATION_INVALID',audit);
  if(audit.verdict!=='PASS') return blocked(`INDEPENDENT_AI_AUDIT_${String(audit.verdict??'UNKNOWN')}`,audit);
  if(audit.promotionAllowed!==true) return blocked('INDEPENDENT_AI_AUDIT_PROMOTION_NOT_ALLOWED',audit);
  return {
    contract:INDEPENDENT_AI_AUDIT_CONTRACT,
    status:'PASS',
    pass:true,
    promotionAllowed:true,
    decisionUse:false,
    productionMutationAllowed:false,
    reason:'INDEPENDENT_AI_AUDIT_CLEAR',
    audit,
  };
}
