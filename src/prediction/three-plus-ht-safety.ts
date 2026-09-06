export const THREE_PLUS_HT_SAFETY_VERSION='CFI_3PLUS_HT_CALIBRATION_SAFETY_V1';
export const THREE_PLUS_HT_EVENT='3+ HT ≡ HT O2.5';
export const THREE_PLUS_HT_DEFAULT_TOLERANCE=.01;
export const THREE_PLUS_HT_MAX_TOLERANCE=.01;
export const THREE_PLUS_HT_CALIBRATION_BINS=[
  {label:'0-10%',lo:0,hi:.10},
  {label:'10-20%',lo:.10,hi:.20},
  {label:'20-30%',lo:.20,hi:.30},
  {label:'30-40%',lo:.30,hi:.40},
  {label:'40-50%',lo:.40,hi:.50},
  {label:'50%+',lo:.50,hi:1.0000000001},
] as const;

type CalibrationPoint={probability:number;outcome:boolean|0|1};

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
  return checks.find((x:any)=>String(x?.event??'')===THREE_PLUS_HT_EVENT)??null;
}

export function evaluateThreePlusHtSafety(body:any){
  const rawFinalProbability=probability(body?.markets?.['3+ HT']?.final??body?.ranking?.find?.((x:any)=>x?.target==='3+ HT')?.probability);
  const futureSixChallengerProbability=probability(body?.markets?.['3+ HT']?.methodB);
  const scoreGridProbability=probability(body?.multiMarket?.overUnder?.ht?.['2.5']?.over?.fullWin);
  const check=equivalenceCheck(body);
  const requestedTolerance=finite(check?.tolerance??body?.multiMarketIntegration?.crossCoreConsistency?.tolerance);
  const tolerance=Math.min(THREE_PLUS_HT_MAX_TOLERANCE,Math.max(0,requestedTolerance??THREE_PLUS_HT_DEFAULT_TOLERANCE));
  const observable=rawFinalProbability!==null&&scoreGridProbability!==null;
  const delta=observable?Math.abs(rawFinalProbability!-scoreGridProbability!):null;
  const crossCoreStatus=!observable?'UNAVAILABLE':delta!<=tolerance+1e-12?'PASS':'FAIL';

  // P0 policy: raw FINAL remains visible for audit, but it is not a betting
  // probability until a separate historical calibration artifact is approved.
  const approval=body?.threePlusHtCalibrationApproval??body?.calibrationApproval?.['3+ HT']??null;
  const calibratedProbability=probability(approval?.calibratedProbability??approval?.probability);
  const calibrationApproved=approval?.status==='APPROVED'&&calibratedProbability!==null;
  const reasons:string[]=[];
  if(!calibrationApproved)reasons.push('HISTORICAL_CALIBRATION_NOT_APPROVED');
  if(crossCoreStatus==='FAIL')reasons.push('CROSS_CORE_EQUIVALENCE_FAIL');
  if(crossCoreStatus==='UNAVAILABLE')reasons.push('CROSS_CORE_EQUIVALENCE_UNAVAILABLE');
  const bettingEligible=calibrationApproved&&crossCoreStatus==='PASS';

  return{
    version:THREE_PLUS_HT_SAFETY_VERSION,
    event:THREE_PLUS_HT_EVENT,
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
    policy:'KEEP_RAW_FINAL_FOR_AUDIT; NO_3PLUS_HT_BET_UNTIL_CALIBRATION_APPROVED_AND_EQUIVALENCE_PASS',
  } as const;
}

export function buildThreePlusHtCalibrationBins(points:CalibrationPoint[]){
  const clean=points.map(row=>({p:probability(row?.probability),y:row?.outcome===true||row?.outcome===1?1:0})).filter((row):row is {p:number;y:number}=>row.p!==null);
  return THREE_PLUS_HT_CALIBRATION_BINS.map((bin,index)=>{
    const rows=clean.filter(row=>row.p>=bin.lo&&(index===THREE_PLUS_HT_CALIBRATION_BINS.length-1?row.p<=1:row.p<bin.hi));
    if(!rows.length)return{bin:bin.label,n:0,meanPredicted:null,actualHitRate:null,calibrationGap:null,brier:null};
    const meanPredicted=rows.reduce((s,r)=>s+r.p,0)/rows.length;
    const actualHitRate=rows.reduce((s,r)=>s+r.y,0)/rows.length;
    const brier=rows.reduce((s,r)=>s+(r.p-r.y)**2,0)/rows.length;
    return{bin:bin.label,n:rows.length,meanPredicted:round(meanPredicted),actualHitRate:round(actualHitRate),calibrationGap:round(meanPredicted-actualHitRate),brier:round(brier)};
  });
}
