import { MARKETS, assertStrictPriorDate, clamp01 } from './fusion/contracts.mjs';
import { evaluateRun, deriveTemporalStability } from './promotion-gate.mjs';

export const KNOWLEDGE_CANDIDATE_RUNNER_VERSION = 'CFI_KNOWLEDGE_CANDIDATE_RUNNERS_V1';
export const KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT = Object.freeze({
  version: KNOWLEDGE_CANDIDATE_RUNNER_VERSION,
  researchOnly: true,
  strictPriorRequired: true,
  baselineLock: 'R0_IMMUTABLE',
  productionMutationAllowed: false,
  canonicalDbMutationAllowed: false,
  syntheticEvaluationAllowed: false,
  deterministicRequired: true,
  productionEligible: false,
});

export const CANDIDATE_SPECS = Object.freeze({
  'K038-STATIONARITY-RETRIEVAL': Object.freeze({
    requiredArtifacts: Object.freeze(['strict-prior retrieval runner','stationarity/regime score artifact','paired similarity-only baseline','segment Brier/calibration report']),
  }),
  'K039-STRUCTURE-ANCHORED-MOE': Object.freeze({
    requiredArtifacts: Object.freeze(['strict-prior regime descriptor runner','expert-routing stability report','fixed-ensemble paired baseline','ablation by routing prior']),
  }),
  'K040-EVIDENCE-ASYMMETRY-FORECAST': Object.freeze({
    requiredArtifacts: Object.freeze(['strict-prior evidence partitioner','agent provenance logs','error-correlation matrix','identical-evidence ablation','Brier/calibration report']),
  }),
});

const finite01 = x => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 1;
const stableId = x => String(x?.id ?? x?.evidenceId ?? x?.expert ?? '');
const stableSort = (rows, compare) => [...rows].sort((a,b) => compare(a,b) || stableId(a).localeCompare(stableId(b)));

function assertRunnerHeader({targetDate,maxEvidenceDate}={}){
  assertStrictPriorDate(maxEvidenceDate,targetDate);
  return { targetDate: String(targetDate), maxEvidenceDate: String(maxEvidenceDate) };
}

function immutableEnvelope(experimentCode, header, artifact){
  if(!CANDIDATE_SPECS[experimentCode]) throw new Error('UNKNOWN_EXPERIMENT_CODE');
  return {
    experimentCode,
    runnerVersion: KNOWLEDGE_CANDIDATE_RUNNER_VERSION,
    contract: KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT,
    strictPrior: { verified: true, ...header },
    baselineLock: 'R0_IMMUTABLE',
    researchOnly: true,
    productionEligible: false,
    artifact,
  };
}

export function runK038StationarityRetrieval(input={}){
  const header=assertRunnerHeader(input);
  const candidates=Array.isArray(input.candidates)?input.candidates:[];
  if(candidates.length<2) throw new Error('K038_CANDIDATES_REQUIRED');
  for(const row of candidates){
    if(!stableId(row)) throw new Error('K038_CANDIDATE_ID_REQUIRED');
    if(!finite01(row.similarity)) throw new Error('K038_INVALID_SIMILARITY');
    if(!finite01(row.stationarityScore)) throw new Error('K038_INVALID_STATIONARITY_SCORE');
  }
  const baseline=stableSort(candidates,(a,b)=>Number(b.similarity)-Number(a.similarity)).map((x,rank)=>({id:stableId(x),rank:rank+1,score:Number(x.similarity)}));
  const challenger=stableSort(candidates,(a,b)=>{
    const sa=.65*Number(a.similarity)+.35*Number(a.stationarityScore);
    const sb=.65*Number(b.similarity)+.35*Number(b.stationarityScore);
    return sb-sa;
  }).map((x,rank)=>({id:stableId(x),rank:rank+1,score:Number((.65*Number(x.similarity)+.35*Number(x.stationarityScore)).toFixed(8)),similarity:Number(x.similarity),stationarityScore:Number(x.stationarityScore)}));
  return immutableEnvelope('K038-STATIONARITY-RETRIEVAL',header,{
    type:'STATIONARITY_RETRIEVAL_ARTIFACT',
    pairedSimilarityBaseline:baseline,
    challengerRanking:challenger,
    pairCount:candidates.length,
    scoring:{similarityWeight:.65,stationarityWeight:.35},
  });
}

export function runK039AnchoredRouting(input={}){
  const header=assertRunnerHeader(input);
  const experts=Array.isArray(input.experts)?input.experts:[];
  if(experts.length<2) throw new Error('K039_EXPERTS_REQUIRED');
  const names=new Set();
  for(const x of experts){
    const name=stableId(x);
    if(!name||names.has(name)) throw new Error('K039_UNIQUE_EXPERT_ID_REQUIRED');
    names.add(name);
    if(!finite01(x.anchorWeight)||!finite01(x.regimeFit)) throw new Error('K039_INVALID_ROUTING_INPUT');
    for(const market of MARKETS) if(!finite01(x.probabilities?.[market])) throw new Error(`K039_INVALID_PROBABILITY:${market}`);
  }
  const fixed=1/experts.length;
  const raw=experts.map(x=>({name:stableId(x),value:Number(x.anchorWeight)*(.5+.5*Number(x.regimeFit))}));
  const z=raw.reduce((s,x)=>s+x.value,0);
  if(!(z>0)) throw new Error('K039_ZERO_ROUTING_MASS');
  const anchoredWeights=Object.fromEntries(raw.sort((a,b)=>a.name.localeCompare(b.name)).map(x=>[x.name,x.value/z]));
  const fixedWeights=Object.fromEntries([...names].sort().map(name=>[name,fixed]));
  const probabilities={};
  const fixedProbabilities={};
  for(const market of MARKETS){
    probabilities[market]=clamp01(experts.reduce((s,x)=>s+anchoredWeights[stableId(x)]*Number(x.probabilities[market]),0));
    fixedProbabilities[market]=clamp01(experts.reduce((s,x)=>s+fixed*Number(x.probabilities[market]),0));
  }
  return immutableEnvelope('K039-STRUCTURE-ANCHORED-MOE',header,{
    type:'STRUCTURE_ANCHORED_ROUTING_ARTIFACT',
    regimeDescriptor:input.regimeDescriptor??null,
    anchoredWeights,
    fixedEnsembleBaseline:{weights:fixedWeights,probabilities:fixedProbabilities},
    challenger:{probabilities},
    routingStability:{weightSum:Object.values(anchoredWeights).reduce((a,b)=>a+b,0),deterministicTieBreak:'EXPERT_ID_ASC'},
  });
}

export function partitionK040Evidence(input={}){
  const header=assertRunnerHeader(input);
  const evidence=Array.isArray(input.evidence)?input.evidence:[];
  const agentCount=Number(input.agentCount??3);
  if(!Number.isSafeInteger(agentCount)||agentCount<2) throw new Error('K040_AGENT_COUNT_INVALID');
  if(evidence.length<agentCount) throw new Error('K040_EVIDENCE_REQUIRED');
  const ids=new Set();
  for(const x of evidence){
    const id=stableId(x);
    if(!id||ids.has(id)) throw new Error('K040_UNIQUE_EVIDENCE_ID_REQUIRED');
    ids.add(id);
    assertStrictPriorDate(String(x.maxEvidenceDate??header.maxEvidenceDate),header.targetDate);
  }
  const ordered=stableSort(evidence,(a,b)=>stableId(a).localeCompare(stableId(b)));
  const partitions=Array.from({length:agentCount},(_,i)=>({agent:`AGENT_${i+1}`,evidenceIds:[]}));
  ordered.forEach((x,i)=>partitions[i%agentCount].evidenceIds.push(stableId(x)));
  return immutableEnvelope('K040-EVIDENCE-ASYMMETRY-FORECAST',header,{
    type:'EVIDENCE_ASYMMETRY_PARTITION_ARTIFACT',
    partitions,
    provenanceLog:partitions.map(x=>({agent:x.agent,evidenceIds:[...x.evidenceIds],evidenceCount:x.evidenceIds.length})),
    disjoint:true,
    evidenceCount:evidence.length,
  });
}

function pearson(a,b){
  if(a.length!==b.length||a.length<2) throw new Error('K040_ERROR_VECTOR_LENGTH_MISMATCH');
  const ma=a.reduce((s,x)=>s+x,0)/a.length,mb=b.reduce((s,x)=>s+x,0)/b.length;
  let num=0,da=0,db=0;
  for(let i=0;i<a.length;i++){const xa=a[i]-ma,xb=b[i]-mb;num+=xa*xb;da+=xa*xa;db+=xb*xb;}
  if(!(da>0)||!(db>0)) return 0;
  return num/Math.sqrt(da*db);
}

export function buildK040ErrorCorrelation(agentErrors={}){
  const names=Object.keys(agentErrors).sort();
  if(names.length<2) throw new Error('K040_AGENT_ERRORS_REQUIRED');
  const vectors=Object.fromEntries(names.map(name=>{
    const xs=agentErrors[name];
    if(!Array.isArray(xs)||xs.length<2||xs.some(x=>!Number.isFinite(Number(x)))) throw new Error('K040_INVALID_AGENT_ERROR_VECTOR');
    return [name,xs.map(Number)];
  }));
  const n=vectors[names[0]].length;
  if(names.some(name=>vectors[name].length!==n)) throw new Error('K040_ERROR_VECTOR_LENGTH_MISMATCH');
  const matrix={};
  for(const a of names){matrix[a]={};for(const b of names)matrix[a][b]=a===b?1:Number(pearson(vectors[a],vectors[b]).toFixed(8));}
  return {type:'K040_ERROR_CORRELATION_MATRIX',sampleCount:n,agents:names,matrix,researchOnly:true,productionEligible:false,baselineLock:'R0_IMMUTABLE'};
}

export function auditK040IdenticalEvidence(partitions=[]){
  const seen=new Map();
  const overlaps=[];
  for(const p of partitions){
    const agent=String(p?.agent??'');
    const ids=[...new Set((p?.evidenceIds??[]).map(String))].sort();
    for(const id of ids){
      const owner=seen.get(id);
      if(owner&&owner!==agent) overlaps.push({evidenceId:id,agents:[owner,agent].sort()});
      else seen.set(id,agent);
    }
  }
  return {pass:overlaps.length===0,identicalEvidenceDetected:overlaps.length>0,overlaps,hardFailures:overlaps.length?['K040_IDENTICAL_EVIDENCE_ABLATION_FAIL']:[]};
}

export function buildRealChallengerEvaluation(input={}){
  const {experimentCode,fixtureId,targetDate,maxEvidenceDate,probabilities,outcomes}=input;
  if(!CANDIDATE_SPECS[experimentCode]) throw new Error('UNKNOWN_EXPERIMENT_CODE');
  assertRunnerHeader({targetDate,maxEvidenceDate});
  if(!fixtureId) throw new Error('FIXTURE_ID_REQUIRED');
  if(input.synthetic===true||input.reconstructed===true||input.replayedPredictionHistory===true) throw new Error('REAL_STRICT_PRIOR_EVALUATION_REQUIRED');
  for(const market of MARKETS){
    if(!finite01(probabilities?.[market])) throw new Error(`INVALID_PROBABILITY:${market}`);
    if(outcomes?.[market]!==0&&outcomes?.[market]!==1) throw new Error(`INVALID_OUTCOME:${market}`);
  }
  return {
    experimentCode,
    fixtureId:String(fixtureId),
    targetTimestamp:`${targetDate}T00:00:00.000Z`,
    maxEvidenceTimestamp:`${maxEvidenceDate}T23:59:59.999Z`,
    probabilities:Object.fromEntries(MARKETS.map(m=>[m,Number(probabilities[m])])),
    actual:Object.fromEntries(MARKETS.map(m=>[m,Number(outcomes[m])])),
    top3HT:Array.isArray(input.top3HT)?input.top3HT:[],
    top3FT:Array.isArray(input.top3FT)?input.top3FT:[],
    actualScore:input.actualScore??{},
    reconstructed:false,
    replayedPredictionHistory:false,
    nondeterministic:Boolean(input.nondeterministic),
    directionalFailure:Boolean(input.directionalFailure),
    researchOnly:true,
    productionEligible:false,
    baselineLock:'R0_IMMUTABLE',
  };
}

export function evaluateRealCandidateRows(rows=[],options={}){
  if(!Array.isArray(rows)||!rows.length) return {status:'FAIL_HARD_GATE',score:0,shadowEligible:false,productionEligible:false,baselineLock:'R0_IMMUTABLE',hardFailures:['INSUFFICIENT_REAL_EVIDENCE']};
  const stability=deriveTemporalStability(rows,MARKETS,options.stabilityOptions??{}).score;
  const result=evaluateRun(rows,{...options,markets:MARKETS,stability,requireTop3:options.requireTop3??false});
  return {...result,baselineLock:'R0_IMMUTABLE',productionEligible:false};
}
