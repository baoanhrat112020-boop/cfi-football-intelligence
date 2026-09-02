import { fairTwoWayProbabilities, fairThreeWayProbabilities, validateMarketSnapshot, buildDecisionSnapshot } from './market-snapshot-contract.mjs';

export const FORWARD_MARKET_EVIDENCE_PIPELINE_V1={
  version:'CFI_FORWARD_MARKET_EVIDENCE_PIPELINE_V1',
  researchOnly:true,
  decisionUse:false,
  baselineLock:'R0_IMMUTABLE',
  syntheticCaptureAllowed:false,
  reconstructedCaptureAllowed:false,
};

const finite=(x)=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const iso=(x)=>Number.isFinite(Date.parse(String(x??'')));
const sideSet=new Set(['HOME','DRAW','AWAY','OVER','UNDER']);
const provenance=(x)=>{
  if(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length)return x;
  if(typeof x==='string'&&x.trim())return {ref:x.trim()};
  return null;
};

export function normalizeForwardMarketCapture(raw={}){
  const errors=[];
  if(raw.synthetic===true)errors.push('SYNTHETIC_CAPTURE_FORBIDDEN');
  if(raw.reconstructed===true)errors.push('RECONSTRUCTED_CAPTURE_FORBIDDEN');
  if(!String(raw.source_name??'').trim())errors.push('SOURCE_NAME_REQUIRED');
  const sourceProvenance=provenance(raw.source_provenance);if(!sourceProvenance)errors.push('SOURCE_PROVENANCE_REQUIRED');
  if(!iso(raw.captured_at)||!iso(raw.kickoff_at))errors.push('VALID_TIMESTAMPS_REQUIRED');
  const row={
    fixture_id:raw.fixture_id??null,
    verified_fixture_id:raw.verified_fixture_id??null,
    captured_at:raw.captured_at,
    kickoff_at:raw.kickoff_at,
    bookmaker:raw.bookmaker,
    market_family:raw.market_family,
    period:raw.period,
    line:finite(raw.line)?Number(raw.line):null,
    odds_home:finite(raw.odds_home)?Number(raw.odds_home):null,
    odds_draw:finite(raw.odds_draw)?Number(raw.odds_draw):null,
    odds_away:finite(raw.odds_away)?Number(raw.odds_away):null,
    odds_over:finite(raw.odds_over)?Number(raw.odds_over):null,
    odds_under:finite(raw.odds_under)?Number(raw.odds_under):null,
    source_name:raw.source_name,
    source_url:typeof raw.source_url==='string'&&raw.source_url.trim()?raw.source_url.trim():null,
    source_provenance:sourceProvenance,
    is_closing:raw.is_closing===true,
    research_only:true,
  };
  const audit=validateMarketSnapshot(row);
  errors.push(...audit.errors);
  return {version:FORWARD_MARKET_EVIDENCE_PIPELINE_V1.version,status:errors.length?'BLOCKED':'READY',errors:[...new Set(errors)],row:errors.length?null:row,decisionUse:false};
}

export function deriveFairMarketProbability(snapshot,selection){
  if(!sideSet.has(selection))throw new Error('SELECTION_INVALID');
  const audit=validateMarketSnapshot(snapshot);if(!audit.valid)throw new Error('MARKET_SNAPSHOT_INVALID');
  if(snapshot.market_family==='1X2'){
    const p=fairThreeWayProbabilities(snapshot.odds_home,snapshot.odds_draw,snapshot.odds_away);
    if(selection==='HOME')return {probability:p.home,vig:p.vig};
    if(selection==='DRAW')return {probability:p.draw,vig:p.vig};
    if(selection==='AWAY')return {probability:p.away,vig:p.vig};
    throw new Error('SELECTION_MARKET_MISMATCH');
  }
  if(snapshot.market_family==='OVER_UNDER'){
    const p=fairTwoWayProbabilities(snapshot.odds_over,snapshot.odds_under);
    if(selection==='OVER')return {probability:p.a,vig:p.vig};
    if(selection==='UNDER')return {probability:p.b,vig:p.vig};
    throw new Error('SELECTION_MARKET_MISMATCH');
  }
  if(snapshot.market_family==='ASIAN_HANDICAP'){
    const p=fairTwoWayProbabilities(snapshot.odds_home,snapshot.odds_away);
    if(selection==='HOME')return {probability:p.a,vig:p.vig};
    if(selection==='AWAY')return {probability:p.b,vig:p.vig};
    throw new Error('SELECTION_MARKET_MISMATCH');
  }
  throw new Error('MARKET_FAMILY_INVALID');
}

export function buildForwardDecision(args={}){
  const {snapshot,selection,cfi_probability,prediction_snapshot_id=null,research_prediction_snapshot_id=null,market_snapshot_id,decision_timestamp,uncertainty={},stake_simulated=0,decision='SHADOW'}=args;
  const market=deriveFairMarketProbability(snapshot,selection);
  const row=buildDecisionSnapshot({prediction_snapshot_id,research_prediction_snapshot_id,market_snapshot_id,cfi_probability,market_probability:market.probability,uncertainty:uncertainty??{},decision,stake_simulated,decision_timestamp,selection},snapshot);
  return {...row,vig:market.vig,productionEligible:false};
}

const classify=(x)=>x>1e-9?1:x<-1e-9?-1:0;
const quarterLines=(line)=>{const q=Math.round(Number(line)*4)/4;const f=Math.abs(q-Math.trunc(q));return Math.abs(f-.25)<1e-9||Math.abs(f-.75)<1e-9?[q-.25,q+.25]:[q,q];};
const combine=(a,b)=>a===1&&b===1?'FULL_WIN':a===-1&&b===-1?'FULL_LOSS':(a===1&&b===0)||(a===0&&b===1)?'HALF_WIN':(a===-1&&b===0)||(a===0&&b===-1)?'HALF_LOSS':'PUSH';

export function settleForwardMarket({snapshot,selection,homeGoals,awayGoals,settled_at,result_provenance}){
  const audit=validateMarketSnapshot(snapshot);if(!audit.valid)throw new Error('MARKET_SNAPSHOT_INVALID');
  if(!iso(settled_at)||Date.parse(settled_at)<=Date.parse(snapshot.kickoff_at))throw new Error('SETTLEMENT_MUST_FOLLOW_KICKOFF');
  if(!provenance(result_provenance))throw new Error('RESULT_PROVENANCE_REQUIRED');
  if(!Number.isInteger(homeGoals)||homeGoals<0||!Number.isInteger(awayGoals)||awayGoals<0)throw new Error('VALID_FINAL_SCORE_REQUIRED');
  if(snapshot.market_family==='1X2'){
    const actual=homeGoals>awayGoals?'HOME':homeGoals<awayGoals?'AWAY':'DRAW';
    if(!['HOME','DRAW','AWAY'].includes(selection))throw new Error('SELECTION_MARKET_MISMATCH');
    return {version:'CFI_FORWARD_MARKET_SETTLEMENT_V1',state:selection===actual?'FULL_WIN':'FULL_LOSS',actual,result_provenance:provenance(result_provenance),settled_at,immutable:true};
  }
  let x,y;
  if(snapshot.market_family==='OVER_UNDER'){
    const [a,b]=quarterLines(snapshot.line),total=homeGoals+awayGoals;
    if(selection==='OVER'){x=classify(total-a);y=classify(total-b);}else if(selection==='UNDER'){x=classify(a-total);y=classify(b-total);}else throw new Error('SELECTION_MARKET_MISMATCH');
  }else if(snapshot.market_family==='ASIAN_HANDICAP'){
    const diff=selection==='HOME'?homeGoals-awayGoals:selection==='AWAY'?awayGoals-homeGoals:null;
    if(diff===null)throw new Error('SELECTION_MARKET_MISMATCH');
    const signedLine=selection==='HOME'?Number(snapshot.line):-Number(snapshot.line);
    const [la,lb]=quarterLines(signedLine);x=classify(diff+la);y=classify(diff+lb);
  }else throw new Error('MARKET_FAMILY_INVALID');
  return {version:'CFI_FORWARD_MARKET_SETTLEMENT_V1',state:combine(x,y),result_provenance:provenance(result_provenance),settled_at,immutable:true};
}

export function forwardCollectionReadiness(realCaptures=[]){
  if(!realCaptures.length)return {version:FORWARD_MARKET_EVIDENCE_PIPELINE_V1.version,status:'BLOCKED',hardFailures:['NO_REAL_FORWARD_MARKET_CAPTURE'],eligible:0,decisionUse:false};
  const normalized=realCaptures.map(normalizeForwardMarketCapture),eligible=normalized.filter(x=>x.status==='READY').length;
  const failures=normalized.flatMap(x=>x.errors);
  return {version:FORWARD_MARKET_EVIDENCE_PIPELINE_V1.version,status:eligible===realCaptures.length?'READY':'BLOCKED',hardFailures:[...new Set(failures)],eligible,total:realCaptures.length,decisionUse:false};
}
