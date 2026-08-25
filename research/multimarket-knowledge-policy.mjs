export const MULTIMARKET_KNOWLEDGE_POLICY_VERSION='CFI_MULTIMARKET_KNOWLEDGE_POLICY_V1';
export const BASELINE_LOCK='R0_IMMUTABLE';
export const HUNT_WEIGHTS=Object.freeze({multiMarket:0.60,foundational:0.40});
export const ACCEPTED_PROVENANCE=Object.freeze(['SOURCE_VERIFIED','CROSS_CHECKED','VERIFIED']);
export const TRACKS=Object.freeze({
  P1_OVER_UNDER:{rank:1,family:'OVER_UNDER'},
  P2_ASIAN_HANDICAP:{rank:2,family:'ASIAN_HANDICAP'},
  P3_JOINT_COHERENCE:{rank:3,family:'JOINT_SCORE'},
  P4_ONE_X_TWO:{rank:4,family:'ONE_X_TWO'},
  P5_MARKET_VALUE:{rank:5,family:'MARKET_VALUE'},
  P6_UNCERTAINTY:{rank:6,family:'UNCERTAINTY'},
  P7_FOUNDATIONAL:{rank:7,family:'FOUNDATIONAL'},
});
const REQUIRED_FIELDS=['knowledge_key','fingerprint','title','source','source_type','provenance_status','summary_vi','applicability_score','multi_market_relevance_score','target_market','cfi_application','required_artifacts','expected_failure_modes','baseline_lock'];
const finiteScore=x=>Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=100;
const nonEmpty=x=>Array.isArray(x)?x.length>0:typeof x==='string'?x.trim().length>0:x!==null&&x!==undefined;
export function knowledgeIdentity(item){return `${String(item?.knowledge_key??'').trim()}::${String(item?.fingerprint??'').trim()}`;}
export function evaluateMultiMarketKnowledge(item,context={}){
  const hardFailures=[];
  for(const field of REQUIRED_FIELDS)if(!nonEmpty(item?.[field]))hardFailures.push(`MISSING_${field.toUpperCase()}`);
  if(!finiteScore(item?.applicability_score))hardFailures.push('INVALID_APPLICABILITY_SCORE');
  if(!finiteScore(item?.multi_market_relevance_score))hardFailures.push('INVALID_MULTI_MARKET_RELEVANCE_SCORE');
  if(Number(item?.applicability_score)<70)hardFailures.push('APPLICABILITY_BELOW_70');
  if(Number(item?.multi_market_relevance_score)<70)hardFailures.push('MULTI_MARKET_RELEVANCE_BELOW_70');
  if(!ACCEPTED_PROVENANCE.includes(item?.provenance_status))hardFailures.push('PROVENANCE_NOT_QUEUE_ELIGIBLE');
  if(item?.baseline_lock!==BASELINE_LOCK)hardFailures.push('R0_BASELINE_NOT_LOCKED');
  if(!Object.prototype.hasOwnProperty.call(TRACKS,item?.target_market))hardFailures.push('UNKNOWN_MULTI_MARKET_TRACK');
  const prior=String(context?.previousStatus??'').toUpperCase();
  if((prior==='REJECTED'||prior==='HARMFUL')&&!(context?.newVersion||context?.newProvenance||context?.newEvidence))hardFailures.push('REJECTED_REQUIRES_NEW_VERSION_PROVENANCE_OR_EVIDENCE');
  const applicability=finiteScore(item?.applicability_score)?Number(item.applicability_score):0;
  const multiMarket=finiteScore(item?.multi_market_relevance_score)?Number(item.multi_market_relevance_score):0;
  const huntScore=Math.round((HUNT_WEIGHTS.multiMarket*multiMarket+HUNT_WEIGHTS.foundational*applicability)*100)/100;
  return {version:MULTIMARKET_KNOWLEDGE_POLICY_VERSION,queueEligible:hardFailures.length===0,baselineLock:BASELINE_LOCK,huntScore,track:item?.target_market??null,hardFailures,identity:knowledgeIdentity(item)};
}
