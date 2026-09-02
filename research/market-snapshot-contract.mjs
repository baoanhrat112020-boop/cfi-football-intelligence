export const MARKET_SNAPSHOT_VERSION='CFI_MARKET_SNAPSHOT_V1';
export const DECISION_SNAPSHOT_VERSION='CFI_DECISION_SNAPSHOT_V1';
const FAMILIES=new Set(['1X2','OVER_UNDER','ASIAN_HANDICAP']);
const PERIODS=new Set(['HT','FT']);
const DECISIONS=new Set(['BET_SIMULATED','WATCH','PASS','SHADOW']);
const odd=x=>Number.isFinite(Number(x))&&Number(x)>1;
const prob=x=>Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=1;
const iso=x=>Number.isFinite(Date.parse(String(x??'')));
const nn=(...xs)=>xs.filter(x=>x!==null&&x!==undefined&&String(x).trim()!=='').length;
export function fairTwoWayProbabilities(a,b){if(!odd(a)||!odd(b))throw new Error('INVALID_TWO_WAY_ODDS');const ia=1/Number(a),ib=1/Number(b),z=ia+ib;return {a:ia/z,b:ib/z,vig:z-1};}
export function fairThreeWayProbabilities(home,draw,away){if(!odd(home)||!odd(draw)||!odd(away))throw new Error('INVALID_THREE_WAY_ODDS');const ih=1/Number(home),id=1/Number(draw),ia=1/Number(away),z=ih+id+ia;return {home:ih/z,draw:id/z,away:ia/z,vig:z-1};}
export function validateMarketSnapshot(s={}){
  const errors=[];
  if(nn(s.fixture_id,s.verified_fixture_id)!==1)errors.push('EXACTLY_ONE_FIXTURE_REFERENCE_REQUIRED');
  if(!iso(s.captured_at)||!iso(s.kickoff_at))errors.push('VALID_TIMESTAMPS_REQUIRED');
  else if(Date.parse(s.captured_at)>=Date.parse(s.kickoff_at))errors.push('CAPTURE_MUST_PRECEDE_KICKOFF');
  if(!String(s.bookmaker??'').trim())errors.push('BOOKMAKER_REQUIRED');
  if(!FAMILIES.has(s.market_family))errors.push('MARKET_FAMILY_INVALID');
  if(!PERIODS.has(s.period))errors.push('PERIOD_INVALID');
  if(!String(s.source_name??'').trim())errors.push('SOURCE_PROVENANCE_REQUIRED');
  if(s.market_family==='1X2'&&(!odd(s.odds_home)||!odd(s.odds_draw)||!odd(s.odds_away)))errors.push('ONE_X_TWO_ODDS_REQUIRED');
  if(s.market_family==='OVER_UNDER'&&(!Number.isFinite(Number(s.line))||!odd(s.odds_over)||!odd(s.odds_under)))errors.push('OVER_UNDER_LINE_AND_ODDS_REQUIRED');
  if(s.market_family==='ASIAN_HANDICAP'&&(!Number.isFinite(Number(s.line))||!odd(s.odds_home)||!odd(s.odds_away)))errors.push('ASIAN_HANDICAP_LINE_AND_ODDS_REQUIRED');
  return {version:MARKET_SNAPSHOT_VERSION,valid:errors.length===0,errors,researchOnly:true,predictionEligible:s.is_closing!==true};
}
export function validateDecisionSnapshot(d={},marketSnapshot={}){
  const errors=[];
  const marketAudit=validateMarketSnapshot(marketSnapshot);if(!marketAudit.valid)errors.push('MARKET_SNAPSHOT_INVALID');
  if(marketSnapshot?.is_closing===true)errors.push('CLOSING_PRICE_NOT_ALLOWED_FOR_PREMATCH_DECISION');
  if(nn(d.prediction_snapshot_id,d.research_prediction_snapshot_id)!==1)errors.push('EXACTLY_ONE_PREDICTION_REFERENCE_REQUIRED');
  if(!d.market_snapshot_id)errors.push('MARKET_SNAPSHOT_ID_REQUIRED');
  if(!prob(d.cfi_probability)||!prob(d.market_probability))errors.push('VALID_PROBABILITIES_REQUIRED');
  if(!iso(d.decision_timestamp))errors.push('DECISION_TIMESTAMP_REQUIRED');
  else if(iso(marketSnapshot?.kickoff_at)&&Date.parse(d.decision_timestamp)>=Date.parse(marketSnapshot.kickoff_at))errors.push('DECISION_MUST_PRECEDE_KICKOFF');
  if(!DECISIONS.has(d.decision))errors.push('DECISION_INVALID');
  if(d.decisionUse===true||d.decision_use===true)errors.push('DECISION_USE_MUST_BE_FALSE');
  const stake=Number(d.stake_simulated??0);if(!Number.isFinite(stake)||stake<0)errors.push('SIMULATED_STAKE_INVALID');
  if(stake>0&&d.decision!=='BET_SIMULATED')errors.push('STAKE_ONLY_ALLOWED_FOR_SIMULATED_BET');
  return {version:DECISION_SNAPSHOT_VERSION,valid:errors.length===0,errors,researchOnly:true,decisionUse:false};
}
export function buildDecisionSnapshot(input,marketSnapshot){
  const row={...input,edge:Number(input?.cfi_probability)-Number(input?.market_probability),decisionUse:false,decision_use:false,research_only:true};
  const audit=validateDecisionSnapshot(row,marketSnapshot);if(!audit.valid)throw new Error(audit.errors.join('|'));
  return {...row,version:DECISION_SNAPSHOT_VERSION};
}
