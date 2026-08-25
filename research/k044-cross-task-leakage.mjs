import { assertStrictPriorDate } from './fusion/contracts.mjs';

export const K044_VERSION='CFI_K044_CROSS_TASK_LEAKAGE_V1';
export const K044_CONTRACT=Object.freeze({
  version:K044_VERSION,
  experimentCode:'K044-CROSS-TASK-LEAKAGE',
  researchOnly:true,
  baselineLock:'R0_IMMUTABLE',
  strictPriorRequired:true,
  productionMutationAllowed:false,
  canonicalDbMutationAllowed:false,
  syntheticEvaluationAllowed:false,
  deterministicRequired:true,
  decisionUse:false,
  productionEligible:false,
});

const finite01=x=>Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=1;
const isoDay=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x??''));
const brier=(p,y)=>(Number(p)-Number(y))**2;
const taskId=x=>String(x?.taskId??'').trim();

function validateTask(row){
  const id=taskId(row);
  if(!id)throw new Error('K044_TASK_ID_REQUIRED');
  if(!isoDay(row.targetDate)||!isoDay(row.maxEvidenceDate))throw new Error('K044_DATE_REQUIRED');
  assertStrictPriorDate(String(row.maxEvidenceDate),String(row.targetDate));
  if(!finite01(row.withCrossTaskProbability)||!finite01(row.withoutCrossTaskProbability))throw new Error('K044_INVALID_PROBABILITY');
  if(row.outcome!==0&&row.outcome!==1)throw new Error('K044_INVALID_OUTCOME');
  const visibility=Array.isArray(row.crossTaskVisibility)?row.crossTaskVisibility:[];
  const seen=new Set();
  for(const v of visibility){
    const sourceTaskId=String(v?.taskId??'').trim();
    if(!sourceTaskId||sourceTaskId===id||seen.has(sourceTaskId))throw new Error('K044_UNIQUE_CROSS_TASK_ID_REQUIRED');
    seen.add(sourceTaskId);
    if(!isoDay(v.revealDate))throw new Error('K044_REVEAL_DATE_REQUIRED');
  }
  return{id,visibility};
}

export function runK044CrossTaskLeakage(input={}){
  const tasks=Array.isArray(input.tasks)?input.tasks:[];
  if(tasks.length<2)throw new Error('K044_DATE_GATED_COHORT_REQUIRED');
  if(input.synthetic===true||input.reconstructed===true||input.replayedPredictionHistory===true)throw new Error('K044_REAL_REPLAY_REQUIRED');
  const ids=new Set();
  const rows=tasks.map(row=>{
    const {id,visibility}=validateTask(row);
    if(ids.has(id))throw new Error('K044_UNIQUE_TASK_ID_REQUIRED');
    ids.add(id);
    const leaking=visibility.filter(v=>String(v.revealDate)>=String(row.targetDate)).map(v=>({taskId:String(v.taskId),revealDate:String(v.revealDate)})).sort((a,b)=>a.taskId.localeCompare(b.taskId));
    const safe=visibility.filter(v=>String(v.revealDate)<String(row.targetDate)).map(v=>({taskId:String(v.taskId),revealDate:String(v.revealDate)})).sort((a,b)=>a.taskId.localeCompare(b.taskId));
    const withBrier=brier(row.withCrossTaskProbability,row.outcome);
    const withoutBrier=brier(row.withoutCrossTaskProbability,row.outcome);
    return{
      taskId:id,
      targetDate:String(row.targetDate),
      maxEvidenceDate:String(row.maxEvidenceDate),
      outcome:Number(row.outcome),
      withCrossTaskProbability:Number(row.withCrossTaskProbability),
      withoutCrossTaskProbability:Number(row.withoutCrossTaskProbability),
      withCrossTaskBrier:withBrier,
      withoutCrossTaskBrier:withoutBrier,
      leakageUplift:Number((withoutBrier-withBrier).toFixed(12)),
      leakingVisibility:leaking,
      allowedVisibility:safe,
      filterRequired:leaking.length>0,
    };
  }).sort((a,b)=>a.targetDate.localeCompare(b.targetDate)||a.taskId.localeCompare(b.taskId));
  const withMean=rows.reduce((s,x)=>s+x.withCrossTaskBrier,0)/rows.length;
  const withoutMean=rows.reduce((s,x)=>s+x.withoutCrossTaskBrier,0)/rows.length;
  const leakingTaskCount=rows.filter(x=>x.filterRequired).length;
  return{
    version:K044_VERSION,
    experimentCode:'K044-CROSS-TASK-LEAKAGE',
    contract:K044_CONTRACT,
    baselineLock:'R0_IMMUTABLE',
    researchOnly:true,
    decisionUse:false,
    productionEligible:false,
    artifact:{
      type:'K044_CROSS_TASK_LEAKAGE_ARTIFACT',
      dateGatedReplayCohort:rows,
      visibilityAblation:{sampleCount:rows.length,meanBrierWithCrossTask:withMean,meanBrierWithoutCrossTask:withoutMean,meanLeakageUplift:Number((withoutMean-withMean).toFixed(12))},
      perTaskLeakageUplift:Object.fromEntries(rows.map(x=>[x.taskId,x.leakageUplift])),
      filterAudit:{leakingTaskCount,pass:leakingTaskCount===0,hardFailures:leakingTaskCount?['K044_CROSS_TASK_VISIBILITY_LEAKAGE_DETECTED']:[]},
      deterministicOrder:'TARGET_DATE_ASC_TASK_ID_ASC',
    },
  };
}
