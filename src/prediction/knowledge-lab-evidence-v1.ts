export const KNOWLEDGE_LAB_EVIDENCE_VERSION='CFI_KNOWLEDGE_LAB_EVIDENCE_V1';
export const KNOWLEDGE_LAB_BASELINE_LOCK='R0_IMMUTABLE' as const;

type BinaryRow={outcome:number;strictPrior:boolean;targetDate?:string;maxEvidenceDate?:string|null};
export type LeakageRow=BinaryRow&{baselineProbability:number;visibleProbability:number};
export type ToolPolicyRow=BinaryRow&{baselineProbability:number;candidateProbability:number;outcomeMatured:boolean;toolCalls:number;toolBudget:number};
export type DistillationRow=BinaryRow&{teacherProbability:number;studentProbability:number;teacherFrozen:boolean;studentFrozen:boolean;horizon:'HT'|'FT';weight?:number};

type CommonResult={
  version:string;
  baselineLock:typeof KNOWLEDGE_LAB_BASELINE_LOCK;
  decisionUse:false;
  productionEligible:false;
  shadowEligible:boolean;
  score:number|null;
  verdict:string;
  hardFailures:string[];
  metrics:Record<string,unknown>;
};

const finite01=(v:number)=>Number.isFinite(v)&&v>=0&&v<=1;
const temporalOk=(r:BinaryRow)=>r.strictPrior===true&&(!r.maxEvidenceDate||!r.targetDate||r.maxEvidenceDate<r.targetDate);
const brier=(rows:Array<{p:number;y:number;w?:number}>)=>{
  let num=0,den=0;
  for(const r of rows){const w=Number.isFinite(r.w)&&Number(r.w)>0?Number(r.w):1;num+=w*(r.p-r.y)**2;den+=w;}
  return den?num/den:NaN;
};
const round=(x:number)=>Number(x.toFixed(12));

export function evaluateCrossTaskLeakage(rows:LeakageRow[]):CommonResult{
  const valid=rows.filter(r=>finite01(r.outcome)&&finite01(r.baselineProbability)&&finite01(r.visibleProbability));
  const hardFailures:string[]=[];
  if(valid.length<30)hardFailures.push('MIN_30_DATE_GATED_ROWS_REQUIRED');
  if(valid.some(r=>!temporalOk(r)))hardFailures.push('TEMPORAL_OR_STRICT_PRIOR_FAILURE');
  const base=valid.length?brier(valid.map(r=>({p:r.baselineProbability,y:r.outcome}))):NaN;
  const visible=valid.length?brier(valid.map(r=>({p:r.visibleProbability,y:r.outcome}))):NaN;
  const uplift=Number.isFinite(base)&&Number.isFinite(visible)?base-visible:NaN;
  const changed=valid.filter(r=>Math.abs(r.visibleProbability-r.baselineProbability)>1e-12).length;
  if(valid.length>=30&&changed===0)hardFailures.push('NO_VISIBILITY_ABLATION_EFFECT');
  const positiveSignal=Number.isFinite(uplift)&&uplift>0.002;
  const score=hardFailures.length?null:Math.max(0,Math.min(100,70+(positiveSignal?20:0)+(changed/Math.max(1,valid.length))*10));
  const shadowEligible=hardFailures.length===0&&positiveSignal&&Number(score)>=80;
  return {
    version:KNOWLEDGE_LAB_EVIDENCE_VERSION,baselineLock:KNOWLEDGE_LAB_BASELINE_LOCK,decisionUse:false,productionEligible:false,
    shadowEligible,score:score===null?null:round(score),
    verdict:hardFailures.length?'BLOCKED':positiveSignal?'LEAKAGE_RISK_VALIDATED':'NEEDS_TARGETED_VISIBILITY_ABLATION',hardFailures,
    metrics:{rows:valid.length,baselineBrier:Number.isFinite(base)?round(base):null,visibleBrier:Number.isFinite(visible)?round(visible):null,leakageUplift:Number.isFinite(uplift)?round(uplift):null,visibilityChangedRows:changed}
  };
}

export function evaluateAgenticToolPolicy(rows:ToolPolicyRow[]):CommonResult{
  const valid=rows.filter(r=>finite01(r.outcome)&&finite01(r.baselineProbability)&&finite01(r.candidateProbability));
  const hardFailures:string[]=[];
  if(valid.length<30)hardFailures.push('MIN_30_WALK_FORWARD_ROWS_REQUIRED');
  if(valid.some(r=>!temporalOk(r)))hardFailures.push('TEMPORAL_OR_STRICT_PRIOR_FAILURE');
  if(valid.some(r=>r.outcomeMatured!==true))hardFailures.push('UNMATURED_OUTCOME_REWARD_FORBIDDEN');
  if(valid.some(r=>!Number.isInteger(r.toolCalls)||!Number.isInteger(r.toolBudget)||r.toolCalls<0||r.toolBudget<0||r.toolCalls>r.toolBudget))hardFailures.push('TOOL_BUDGET_VIOLATION');
  const base=valid.length?brier(valid.map(r=>({p:r.baselineProbability,y:r.outcome}))):NaN;
  const candidate=valid.length?brier(valid.map(r=>({p:r.candidateProbability,y:r.outcome}))):NaN;
  const delta=Number.isFinite(base)&&Number.isFinite(candidate)?base-candidate:NaN;
  const nonInferior=Number.isFinite(delta)&&delta>=0;
  const score=hardFailures.length?null:Math.max(0,Math.min(100,75+(nonInferior?15:0)+(Number.isFinite(delta)&&delta>0.005?10:0)));
  const shadowEligible=hardFailures.length===0&&nonInferior&&Number(score)>=80;
  return {
    version:KNOWLEDGE_LAB_EVIDENCE_VERSION,baselineLock:KNOWLEDGE_LAB_BASELINE_LOCK,decisionUse:false,productionEligible:false,
    shadowEligible,score:score===null?null:round(score),verdict:hardFailures.length?'BLOCKED':shadowEligible?'SHADOW_ELIGIBLE':'NO_IMPROVEMENT',hardFailures,
    metrics:{rows:valid.length,baselineBrier:Number.isFinite(base)?round(base):null,candidateBrier:Number.isFinite(candidate)?round(candidate):null,brierImprovement:Number.isFinite(delta)?round(delta):null,totalToolCalls:valid.reduce((s,r)=>s+r.toolCalls,0)}
  };
}

export function evaluateHorizonDistillation(rows:DistillationRow[]):CommonResult{
  const valid=rows.filter(r=>finite01(r.outcome)&&finite01(r.teacherProbability)&&finite01(r.studentProbability));
  const hardFailures:string[]=[];
  if(valid.length<30)hardFailures.push('MIN_30_LOCKED_WALK_FORWARD_ROWS_REQUIRED');
  if(valid.some(r=>!temporalOk(r)))hardFailures.push('TEMPORAL_OR_STRICT_PRIOR_FAILURE');
  if(valid.some(r=>r.teacherFrozen!==true||r.studentFrozen!==true))hardFailures.push('FROZEN_TEACHER_STUDENT_REQUIRED');
  if(!valid.some(r=>r.horizon==='HT')||!valid.some(r=>r.horizon==='FT'))hardFailures.push('BOTH_HT_FT_HORIZONS_REQUIRED');
  const teacher=valid.length?brier(valid.map(r=>({p:r.teacherProbability,y:r.outcome,w:r.weight}))):NaN;
  const student=valid.length?brier(valid.map(r=>({p:r.studentProbability,y:r.outcome,w:r.weight}))):NaN;
  const mimic=valid.length?valid.reduce((s,r)=>s+(r.weight&&r.weight>0?r.weight:1)*(r.studentProbability-r.teacherProbability)**2,0)/valid.reduce((s,r)=>s+(r.weight&&r.weight>0?r.weight:1),0):NaN;
  const delta=Number.isFinite(teacher)&&Number.isFinite(student)?teacher-student:NaN;
  const nonInferior=Number.isFinite(delta)&&delta>=-0.01;
  const aligned=Number.isFinite(mimic)&&mimic<=0.02;
  const score=hardFailures.length?null:Math.max(0,Math.min(100,70+(nonInferior?15:0)+(aligned?15:0)));
  const shadowEligible=hardFailures.length===0&&nonInferior&&aligned&&Number(score)>=80;
  return {
    version:KNOWLEDGE_LAB_EVIDENCE_VERSION,baselineLock:KNOWLEDGE_LAB_BASELINE_LOCK,decisionUse:false,productionEligible:false,
    shadowEligible,score:score===null?null:round(score),verdict:hardFailures.length?'BLOCKED':shadowEligible?'SHADOW_ELIGIBLE':'DISTILLATION_REGRESSION',hardFailures,
    metrics:{rows:valid.length,teacherBrier:Number.isFinite(teacher)?round(teacher):null,studentBrier:Number.isFinite(student)?round(student):null,brierImprovement:Number.isFinite(delta)?round(delta):null,teacherStudentMse:Number.isFinite(mimic)?round(mimic):null,htRows:valid.filter(r=>r.horizon==='HT').length,ftRows:valid.filter(r=>r.horizon==='FT').length}
  };
}
