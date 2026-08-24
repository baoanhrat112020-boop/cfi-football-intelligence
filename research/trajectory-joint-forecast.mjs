export const K048_VERSION='CFI_K048_TRAJECTORY_JOINT_V1';
export const K048_CONTRACT=Object.freeze({researchOnly:true,decisionUse:false,baselineLock:'R0_IMMUTABLE',productionMutationAllowed:false,syntheticEvaluationAllowed:false,strictPriorRequired:true});

const EPS=1e-12;
function parseScore(score){const m=String(score??'').match(/^(\d+)-(\d+)$/);if(!m)throw new Error('K048_INVALID_SCORE');return [Number(m[1]),Number(m[2])];}
function normalize(rows,label){if(!Array.isArray(rows)||rows.length<1)throw new Error(`K048_${label}_REQUIRED`);const seen=new Set();let z=0;const out=rows.map(r=>{const score=String(r?.score??'');parseScore(score);if(seen.has(score))throw new Error(`K048_${label}_DUPLICATE_SCORE`);seen.add(score);const p=Number(r?.probability);if(!Number.isFinite(p)||p<0)throw new Error(`K048_${label}_INVALID_PROBABILITY`);z+=p;return{score,probability:p};});if(!(z>0))throw new Error(`K048_${label}_ZERO_MASS`);return out.map(r=>({...r,probability:r.probability/z}));}
function compatible(ht,ft){const [hh,ha]=parseScore(ht),[fh,fa]=parseScore(ft);return fh>=hh&&fa>=ha;}
function marginals(ht,ft,matrix){const h=ht.map(()=>0),f=ft.map(()=>0);for(let i=0;i<ht.length;i++)for(let j=0;j<ft.length;j++){h[i]+=matrix[i][j];f[j]+=matrix[i][j];}return{ht:h,ft:f};}
function maxAbsDelta(a,b){let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;}

export function buildK048TrajectoryEnsemble(input={}){
  const targetDate=String(input.targetDate??''),maxEvidenceDate=String(input.maxEvidenceDate??'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!/^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)||maxEvidenceDate>=targetDate)throw new Error('STRICT_PRIOR_FAILURE');
  const ht=normalize(input.htMarginal,'HT_MARGINAL'),ft=normalize(input.ftMarginal,'FT_MARGINAL');
  const matrix=ht.map((h,i)=>ft.map((f,j)=>compatible(h.score,f.score)?Math.max(EPS,h.probability*f.probability):0));
  for(let i=0;i<ht.length;i++)if(matrix[i].every(x=>x===0))throw new Error('K048_INFEASIBLE_HT_SUPPORT');
  for(let j=0;j<ft.length;j++)if(matrix.every(row=>row[j]===0))throw new Error('K048_INFEASIBLE_FT_SUPPORT');
  const iterations=Math.max(50,Math.min(5000,Number(input.iterations??1000)));
  const tolerance=Math.max(1e-12,Number(input.tolerance??1e-8));
  for(let k=0;k<iterations;k++){
    for(let i=0;i<ht.length;i++){const s=matrix[i].reduce((a,b)=>a+b,0);if(!(s>0))throw new Error('K048_IPF_ROW_ZERO');const scale=ht[i].probability/s;for(let j=0;j<ft.length;j++)matrix[i][j]*=scale;}
    for(let j=0;j<ft.length;j++){let s=0;for(let i=0;i<ht.length;i++)s+=matrix[i][j];if(!(s>0))throw new Error('K048_IPF_COL_ZERO');const scale=ft[j].probability/s;for(let i=0;i<ht.length;i++)matrix[i][j]*=scale;}
    if(k%10===0){const m=marginals(ht,ft,matrix);if(Math.max(maxAbsDelta(m.ht,ht.map(x=>x.probability)),maxAbsDelta(m.ft,ft.map(x=>x.probability)))<=tolerance)break;}
  }
  const m=marginals(ht,ft,matrix),htErr=maxAbsDelta(m.ht,ht.map(x=>x.probability)),ftErr=maxAbsDelta(m.ft,ft.map(x=>x.probability));
  if(Math.max(htErr,ftErr)>tolerance*10)throw new Error('K048_MARGINAL_PRESERVATION_FAIL');
  const trajectories=[];for(let i=0;i<ht.length;i++)for(let j=0;j<ft.length;j++)if(matrix[i][j]>EPS)trajectories.push({ht:ht[i].score,ft:ft[j].score,probability:matrix[i][j]});
  trajectories.sort((a,b)=>b.probability-a.probability||a.ht.localeCompare(b.ht)||a.ft.localeCompare(b.ft));
  return{version:K048_VERSION,contract:K048_CONTRACT,strictPrior:{verified:true,targetDate,maxEvidenceDate},trajectoryCount:trajectories.length,trajectories,marginalAudit:{status:'PASS',htMaxAbsError:htErr,ftMaxAbsError:ftErr,tolerance},researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE'};
}

export function probabilityOfPathEvent(ensemble,predicate){if(!ensemble||!Array.isArray(ensemble.trajectories)||typeof predicate!=='function')throw new Error('K048_EVENT_INPUT_REQUIRED');let p=0;for(const t of ensemble.trajectories)if(predicate(t))p+=Number(t.probability);return Math.max(0,Math.min(1,p));}
