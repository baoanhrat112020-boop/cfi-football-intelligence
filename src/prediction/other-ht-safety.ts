export const OTHER_HT_SAFETY_VERSION='CFI_OTHER_HT_CALIBRATION_SAFETY_V1';
export const OTHER_HT_EVENT='Other HT ≡ either team HT >= 4';

const probability=(v:any)=>{
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
};

// "Other HT" is a compound either-team threshold (home HT>=4 OR away HT>=4).
// Unlike 3+ HT (≡ HT Over 2.5) and 7+ FT (≡ FT Over 6.5), there is no single
// over/under line in the multi-market grid that is mathematically equivalent
// to this event, so no cross-core equivalence check is possible here. The
// gate is therefore approval-only: fail-closed until an explicit historical
// calibration artifact is approved, same policy as the other two thresholds.
export function evaluateOtherHtSafety(body:any){
  const rawFinalProbability=probability(body?.markets?.['Other HT']?.final??body?.ranking?.find?.((x:any)=>x?.target==='Other HT')?.probability);
  const approval=body?.otherHtCalibrationApproval??body?.calibrationApproval?.['Other HT']??null;
  const calibratedProbability=probability(approval?.calibratedProbability??approval?.probability);
  const calibrationApproved=approval?.status==='APPROVED'&&calibratedProbability!==null;
  const reasons:string[]=[];
  if(!calibrationApproved)reasons.push('HISTORICAL_CALIBRATION_NOT_APPROVED');
  const bettingEligible=calibrationApproved;

  return{
    version:OTHER_HT_SAFETY_VERSION,
    event:OTHER_HT_EVENT,
    status:bettingEligible?'CALIBRATED_READY':'CALIBRATION_REQUIRED',
    bettingStatus:bettingEligible?'ELIGIBLE':'WATCH',
    decisionUse:bettingEligible,
    rawFinalProbability,
    calibratedProbability:calibrationApproved?calibratedProbability:null,
    bettingProbability:bettingEligible?calibratedProbability:null,
    crossCore:{status:'NOT_APPLICABLE',delta:null,tolerance:null,observable:false},
    calibrationApproved,
    approvalVersion:approval?.version??null,
    reasons,
    policy:'KEEP_RAW_FINAL_FOR_AUDIT; NO_OTHER_HT_BET_UNTIL_CALIBRATION_APPROVED; NO_CROSS_CORE_EQUIVALENT_LINE_EXISTS_FOR_THIS_COMPOUND_EVENT',
  } as const;
}
