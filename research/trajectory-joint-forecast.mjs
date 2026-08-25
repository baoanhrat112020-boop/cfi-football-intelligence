export const K048_VERSION='CFI_K048_TRAJECTORY_JOINT_V2_FULL_SUPPORT';
export const K048_CONTRACT=Object.freeze({researchOnly:true,decisionUse:false,baselineLock:'R0_IMMUTABLE',productionMutationAllowed:false,syntheticEvaluationAllowed:false,strictPriorRequired:true,closedSupportRequired:true});

const EPS=1e-12;
function parseScoreComponent(value){const m=String(value??'').match(/^(\d+)(\+)?$/);if(!m)throw new Error('K048_INVALID_SCORE');return{value:Number(m[1]),overflow:Boolean(m[2])};}
function parseScore(score){const m=String(score??'').match(/^(\d+\+?)-(\d+\+?)$/);if(!m)throw new Error('K048_INVALID_SCORE');return[parseScoreComponent(m[1]),parseScoreComponent(m[2])];}
function normalize(rows,label){if(!Array.isArray(rows)||rows.length<1)throw new Error(`K048_${label}_REQUIRED`);const seen=new Set();let z=0;const out=rows.map(r=>{const score=String(r?.score??'');parseScore(score);if(seen.has(score))throw new Error(`K048_${label}_DUPLICATE_SCORE`);seen.add(score);const p=Number(r?.probability);if(!Number.isFinite(p)||p<0)throw new Error(`K048_${label}_INVALID_PROBABILITY`);z+=p;return{score,probability:p};});if(!(z>0))throw new Error(`K048_${label}_ZERO_MASS`);return out.map(r=>({...r,probability:r.probability/z}));}
function compatible(ht,ft){const [hh,ha]=parseScore(ht),[fh,fa]=parseScore(ft);return fh.value>=hh.value&&fa.value>=ha.value;}
function marginals(ht,ft,matrix){const h=ht.map(()=>0),f=ft.map(()=>0);for(let i=0;i<ht.length;i++)for(let j=0;j<ft.length;j++){h[i]+=matrix[i][j];f[j]+=matrix[i][j];}return{ht:h,ft:f};}
function maxAbsDelta(a,b){let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;}
function poissonPmf(lambda,k){if(!(Number.isFinite(lambda)&&lambda>=0)||!Number.isInteger(k)||k<0)throw new Error('K048_POISSON_INPUT_INVALID');if(lambda===0)return k===0?1:0;let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}

export function buildClosedPoissonScoreMarginal({homeLambda,awayLambda,cap=12}={}){
  const lh=Number(homeLambda),la=Number(awayLambda),c=Math.max(4,Math.min(30,Math.trunc(Number(cap)||12)));
  if(!Number.isFinite(lh)||lh<0||!Number.isFinite(la)||la<0)throw new Error('K048_EXPECTED_GOALS_REQUIRED');
  const hp=Array.from({length:c},(_,k)=>poissonPmf(lh,k)),ap=Array.from({length:c},(_,k)=>poissonPmf(la,k));
  const hTail=Math.max(0,1-hp.reduce((s,p)=>s+p,0)),aTail=Math.max(0,1-ap.reduce((s,p)=>s+p,0));
  const rows=[];
  for(let h=0;h<c;h++)for(let a=0;a<c;a++)rows.push({score:`${h}-${a}`,probability:hp[h]*ap[a]});
  if(hTail>0)for(let a=0;a<c;a++)rows.push({score:`${c}+-${a}`,probability:hTail*ap[a]});
  if(aTail>0)for(let h=0;h<c;h++)rows.push({score:`${h}-${c}+`,probability:hp[h]*aTail});
  if(hTail>0&&aTail>0)rows.push({score:`${c}+-${c}+`,probability:hTail*aTail});
  const z=rows.reduce((s,r)=>s+r.probability,0);if(!(z>0))throw new Error('K048_POISSON_ZERO_MASS');
  return rows.map(r=>({...r,probability:r.probability/z}));
}

export function bucketScoreToClosedSupport(score,cap=12){
  const m=String(score??'').match(/^(\d+)-(\d+)$/);if(!m)throw new Error('K048_INVALID_ACTUAL_SCORE');const c=Math.max(4,Math.min(30,Math.trunc(Number(cap)||12))),h=Number(m[1]),a=Number(m[2]);
  return `${h>=c?`${c}+`:h}-${a>=c?`${c}+`:a}`;
}

export function buildK048ClosedSupportInput({targetDate,maxEvidenceDate,htExpectedGoals,ftExpectedGoals,htCap=10,ftCap=14}={}){
  const htHome=Number(htExpectedGoals?.home),htAway=Number(htExpectedGoals?.away),ftHome=Number(ftExpectedGoals?.home),ftAway=Number(ftExpectedGoals?.away);
  return{targetDate,maxEvidenceDate,htMarginal:buildClosedPoissonScoreMarginal({homeLambda:htHome,awayLambda:htAway,cap:htCap}),ftMarginal:buildClosedPoissonScoreMarginal({homeLambda:ftHome,awayLambda:ftAway,cap:ftCap}),support:{closed:true,htCap,ftCap,actualScoreMapper:'bucketScoreToClosedSupport'}};
}

export function buildK048TrajectoryEnsemble(input={}){
  const targetDate=String(input.targetDate??''),maxEvidenceDate=String(input.maxEvidenceDate??'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!/^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)||maxEvidenceDate>=targetDate)throw new Error('STRICT_PRIOR_FAILURE');
  const ht=normalize(input.htMarginal,'HT_MARGINAL'),ft=normalize(input.ftMarginal,'FT_MARGINAL');
  const matrix=ht.map(h=>ft.map(f=>compatible(h.score,f.score)?Math.max(EPS,h.probability*f.probability):0));
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
  const closedSupport=Boolean(input?.support?.closed)&&ht.some(r=>r.score.includes('+'))&&ft.some(r=>r.score.includes('+'));
  return{version:K048_VERSION,contract:K048_CONTRACT,strictPrior:{verified:true,targetDate,maxEvidenceDate},trajectoryCount:trajectories.length,trajectories,marginalAudit:{status:'PASS',htMaxAbsError:htErr,ftMaxAbsError:ftErr,tolerance},supportAudit:{closed:closedSupport,htOverflowBucket:ht.find(r=>r.score.includes('+'))?.score??null,ftOverflowBucket:ft.find(r=>r.score.includes('+'))?.score??null},researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE'};
}

export function probabilityOfPathEvent(ensemble,predicate){if(!ensemble||!Array.isArray(ensemble.trajectories)||typeof predicate!=='function')throw new Error('K048_EVENT_INPUT_REQUIRED');let p=0;for(const t of ensemble.trajectories)if(predicate(t))p+=Number(t.probability);return Math.max(0,Math.min(1,p));}
