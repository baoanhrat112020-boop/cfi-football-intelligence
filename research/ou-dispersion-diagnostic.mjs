export const OU_DISPERSION_DIAGNOSTIC_V1={version:'CFI_OU_DISPERSION_DIAGNOSTIC_V1',researchOnly:true,decisionUse:false,baselineLock:'R0_IMMUTABLE'};
const finite=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x));
export function diagnoseGoalTotalDispersion(rows=[],options={}){
  const minN=Math.max(10,Math.floor(options.minN??30));
  const clean=rows.filter(r=>finite(r.totalGoals)&&Number(r.totalGoals)>=0&&Number.isInteger(Number(r.totalGoals))).map(r=>Number(r.totalGoals));
  if(clean.length<minN)return {version:OU_DISPERSION_DIAGNOSTIC_V1.version,status:'BLOCKED',n:clean.length,hardFailures:['INSUFFICIENT_TOTAL_GOAL_SAMPLE'],decisionUse:false};
  const mean=clean.reduce((a,b)=>a+b,0)/clean.length;
  const variance=clean.reduce((a,b)=>a+(b-mean)**2,0)/(clean.length-1);
  const dispersion=mean>0?variance/mean:null;
  const p90=[...clean].sort((a,b)=>a-b)[Math.min(clean.length-1,Math.ceil(.9*clean.length)-1)];
  const highTailRate=clean.filter(x=>x>=5).length/clean.length;
  const regime=dispersion===null?'UNDEFINED':dispersion>1.2?'OVERDISPERSED':dispersion<.8?'UNDERDISPERSED':'POISSON_LIKE';
  const researchRecommendation=regime==='OVERDISPERSED'?'TEST_NEGATIVE_BINOMIAL_OR_MIXTURE':regime==='UNDERDISPERSED'?'TEST_SHRUNK_COUNT_MODEL':'KEEP_POISSON_AS_CONTROL';
  return {version:OU_DISPERSION_DIAGNOSTIC_V1.version,status:'READY',n:clean.length,mean,variance,dispersion,p90,highTailRate,regime,researchRecommendation,productionEligible:false,decisionUse:false};
}

export function compareTailCalibration(rows=[]){
  const clean=rows.filter(r=>finite(r.predictedOver)&&Number(r.predictedOver)>=0&&Number(r.predictedOver)<=1&&(r.actualOver===0||r.actualOver===1));
  if(!clean.length)return {status:'BLOCKED',hardFailures:['NO_TAIL_CALIBRATION_ROWS']};
  const brier=clean.reduce((s,r)=>s+(Number(r.predictedOver)-r.actualOver)**2,0)/clean.length;
  const avgP=clean.reduce((s,r)=>s+Number(r.predictedOver),0)/clean.length;
  const prevalence=clean.reduce((s,r)=>s+r.actualOver,0)/clean.length;
  return {status:'READY',n:clean.length,brier,avgP,prevalence,calibrationBias:avgP-prevalence,decisionUse:false};
}
