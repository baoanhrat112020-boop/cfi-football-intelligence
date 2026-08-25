export const K049_AGENT_TRAJECTORY_RETRIEVAL_VERSION='CFI_K049_AGENT_TRAJECTORY_RETRIEVAL_V1';
export const K049_CONTRACT=Object.freeze({version:K049_AGENT_TRAJECTORY_RETRIEVAL_VERSION,researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',syntheticAllowed:false,reconstructedAllowed:false,strictPriorRequired:true,maturedOutcomeRequired:true});

const finite=x=>Number.isFinite(Number(x));
const iso=x=>Number.isFinite(Date.parse(String(x??'')));
const clamp=x=>Math.max(0,Math.min(1,Number(x)));
const key=r=>`${r.fixture_id}|${r.target}|${r.prediction_created_at}`;

export function buildMaturedTrajectoryLedger(rows=[]){
  const seen=new Set(),out=[];
  for(const raw of rows){
    if(raw?.synthetic===true||raw?.reconstructed===true)throw new Error('REAL_TRAJECTORY_ROWS_REQUIRED');
    if(!raw?.fixture_id||!raw?.target||!iso(raw.prediction_created_at)||!iso(raw.kickoff_at)||!iso(raw.settled_at))throw new Error('TRAJECTORY_PROVENANCE_REQUIRED');
    if(Date.parse(raw.prediction_created_at)>=Date.parse(raw.kickoff_at))throw new Error('PREDICTION_MUST_PRECEDE_KICKOFF');
    if(Date.parse(raw.settled_at)<=Date.parse(raw.kickoff_at))throw new Error('OUTCOME_MUST_MATURE_AFTER_KICKOFF');
    if(!finite(raw.probability)||Number(raw.probability)<0||Number(raw.probability)>1||![0,1].includes(Number(raw.outcome)))throw new Error('VALID_PROBABILITY_OUTCOME_REQUIRED');
    if(!Array.isArray(raw.trajectory)||raw.trajectory.length===0)throw new Error('AGENT_TRAJECTORY_REQUIRED');
    const k=key(raw); if(seen.has(k))throw new Error('DUPLICATE_TRAJECTORY_ROW'); seen.add(k);
    out.push({...raw,probability:Number(raw.probability),outcome:Number(raw.outcome),brier:(Number(raw.probability)-Number(raw.outcome))**2,immutable:true});
  }
  return out.sort((a,b)=>Date.parse(a.prediction_created_at)-Date.parse(b.prediction_created_at)||key(a).localeCompare(key(b)));
}

function jaccard(a,b){const A=new Set(a.map(String)),B=new Set(b.map(String));const u=new Set([...A,...B]);if(!u.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return i/u.size;}

export function buildTrajectoryPairs({ledger,target_date,minPrior=1}={}){
  if(!iso(target_date))throw new Error('TARGET_DATE_REQUIRED');
  const prior=(ledger??[]).filter(r=>String(r.target_date??r.prediction_created_at).slice(0,10)<String(target_date).slice(0,10));
  if(prior.length<minPrior)throw new Error('INSUFFICIENT_MATURED_PRIOR_TRAJECTORIES');
  const pairs=[];
  for(let i=0;i<prior.length;i++)for(let j=i+1;j<prior.length;j++){
    if(prior[i].fixture_id===prior[j].fixture_id)continue;
    pairs.push({left:key(prior[i]),right:key(prior[j]),trajectorySimilarity:jaccard(prior[i].trajectory,prior[j].trajectory),lossSimilarity:1-Math.min(1,Math.abs(prior[i].brier-prior[j].brier))});
  }
  return {version:K049_AGENT_TRAJECTORY_RETRIEVAL_VERSION,targetDate:String(target_date).slice(0,10),strictPrior:true,pairs};
}

export function rankTrajectoryRetrieval({ledger,query,target_date,k=10}={}){
  if(!query||!Array.isArray(query.trajectory)||!query.trajectory.length)throw new Error('QUERY_TRAJECTORY_REQUIRED');
  if(!iso(target_date))throw new Error('TARGET_DATE_REQUIRED');
  const prior=(ledger??[]).filter(r=>String(r.target_date??r.prediction_created_at).slice(0,10)<String(target_date).slice(0,10));
  if(!prior.length)throw new Error('NO_STRICT_PRIOR_MATURED_TRAJECTORIES');
  const ranked=prior.map(r=>({fixture_id:r.fixture_id,target:r.target,probability:r.probability,outcome:r.outcome,brier:r.brier,similarity:jaccard(query.trajectory,r.trajectory),prediction_created_at:r.prediction_created_at})).sort((a,b)=>b.similarity-a.similarity||a.brier-b.brier||a.prediction_created_at.localeCompare(b.prediction_created_at)||String(a.fixture_id).localeCompare(String(b.fixture_id))).slice(0,k);
  return {version:K049_AGENT_TRAJECTORY_RETRIEVAL_VERSION,status:'READY',researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',strictPrior:true,targetDate:String(target_date).slice(0,10),ranked};
}

export function evaluateTrajectoryRetrievalWalkForward(rows=[],{minSample=30}={}){
  const ledger=buildMaturedTrajectoryLedger(rows),evals=[];
  for(const row of ledger){
    const targetDate=String(row.target_date??row.prediction_created_at).slice(0,10);
    const prior=ledger.filter(r=>String(r.target_date??r.prediction_created_at).slice(0,10)<targetDate&&r.target===row.target);
    if(!prior.length)continue;
    const nearest=prior.map(r=>({...r,similarity:jaccard(row.trajectory,r.trajectory)})).sort((a,b)=>b.similarity-a.similarity||a.brier-b.brier||key(a).localeCompare(key(b)))[0];
    const baseline=prior.reduce((s,r)=>s+r.outcome,0)/prior.length;
    evals.push({fixture_id:row.fixture_id,target:row.target,targetDate,challengerProbability:clamp(nearest.probability),baselineProbability:clamp(baseline),outcome:row.outcome,challengerBrier:(nearest.probability-row.outcome)**2,baselineBrier:(baseline-row.outcome)**2});
  }
  const mean=(xs,f)=>xs.reduce((s,x)=>s+f(x),0)/Math.max(1,xs.length);
  const result={version:K049_AGENT_TRAJECTORY_RETRIEVAL_VERSION,status:evals.length>=minSample?'READY':'BLOCKED',researchOnly:true,decisionUse:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',strictPrior:true,sampleSize:evals.length,challengerBrier:mean(evals,x=>x.challengerBrier),baselineBrier:mean(evals,x=>x.baselineBrier),deltaBrier:mean(evals,x=>x.challengerBrier-x.baselineBrier),rows:evals};
  if(evals.length<minSample)result.hardFailures=['INSUFFICIENT_WALK_FORWARD_RETRIEVAL_SAMPLE'];
  return result;
}
