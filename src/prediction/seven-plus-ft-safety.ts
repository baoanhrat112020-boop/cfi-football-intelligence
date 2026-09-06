export const SEVEN_PLUS_FT_SAFETY_VERSION='CFI_7PLUS_FT_CALIBRATION_SAFETY_V1';
export const SEVEN_PLUS_FT_EVENT='7+ FT ≡ FT O6.5';
export const SEVEN_PLUS_FT_DEFAULT_TOLERANCE=.01;
export const SEVEN_PLUS_FT_MAX_TOLERANCE=.01;

const probability=(v:any)=>{
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
};
const finite=(v:any)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const round=(v:number,d=6)=>{const p=10**d;return Math.round(v*p)/p;};

function equivalenceCheck(body:any){
  const cross=body?.multiMarketIntegration?.crossCoreConsistency??body?.multiMarket?.crossCoreConsistency??null;
  const checks=Array.isArray(cross?.checks)?cross.checks:[];
  return checks.find((x:any)=>String(x?.event??'')===SEVEN_PLUS_FT_EVENT)??null;
}

export function evaluateSevenPlusFtSafety(body:any){
  const rawFinalProbability=probability(body?.markets?.['7+ FT']?.final??body?.ranking?.find?.((x:any)=>x?.target==='7+ FT')?.probability);
  const futureSixChallengerProbability=probability(body?.markets?.['7+ FT']?.methodB);
  const scoreGridProbability=probability(body?.multiMarket?.overUnder?.ft?.['6.5']?.over?.fullWin);
  const check=equivalenceCheck(body);
  const requestedTolerance=finite(check?.tolerance??body?.multiMarketIntegration?.crossCoreConsistency?.tolerance);
  const tolerance=Math.min(SEVEN_PLUS_FT_MAX_TOLERANCE,Math.max(0,requestedTolerance??SEVEN_PLUS_FT_DEFAULT_TOLERANCE));
  const observable=rawFinalProbability!==null&&scoreGridProbability!==null;
  const delta=observable?Math.abs(rawFinalProbability!-scoreGridProbability!):null;
  const crossCoreStatus=!observable?'UNAVAILABLE':delta!<=tolerance+1e-12?'PASS':'FAIL';

  // P0 policy mirrors 3+ HT. The raw probability stays available to research,
  // but practical betting is fail-closed until an independently approved
  // calibration artifact exists and the exact alias event is coherent.
  const approval=body?.sevenPlusFtCalibrationApproval??body?.calibrationApproval?.['7+ FT']??null;
  const calibratedProbability=probability(approval?.calibratedProbability??approval?.probability);
  const calibrationApproved=approval?.status==='APPROVED'&&calibratedProbability!==null;
  const reasons:string[]=[];
  if(!calibrationApproved)reasons.push('HISTORICAL_CALIBRATION_NOT_APPROVED');
  if(crossCoreStatus==='FAIL')reasons.push('CROSS_CORE_EQUIVALENCE_FAIL');
  if(crossCoreStatus==='UNAVAILABLE')reasons.push('CROSS_CORE_EQUIVALENCE_UNAVAILABLE');
  const bettingEligible=calibrationApproved&&crossCoreStatus==='PASS';

  return{
    version:SEVEN_PLUS_FT_SAFETY_VERSION,
    event:SEVEN_PLUS_FT_EVENT,
    status:bettingEligible?'CALIBRATED_READY':'CALIBRATION_REQUIRED',
    bettingStatus:bettingEligible?'ELIGIBLE':'WATCH',
    decisionUse:bettingEligible,
    rawFinalProbability,
    futureSixChallengerProbability,
    preferredChallenger:'FUTURE_SIX',
    scoreGridProbability,
    calibratedProbability:calibrationApproved?calibratedProbability:null,
    bettingProbability:bettingEligible?calibratedProbability:null,
    crossCore:{status:crossCoreStatus,delta:delta===null?null:round(delta),tolerance,observable},
    calibrationApproved,
    approvalVersion:approval?.version??null,
    reasons,
    policy:'KEEP_RAW_FINAL_FOR_AUDIT; NO_7PLUS_FT_BET_UNTIL_CALIBRATION_APPROVED_AND_EQUIVALENCE_PASS',
  } as const;
}
