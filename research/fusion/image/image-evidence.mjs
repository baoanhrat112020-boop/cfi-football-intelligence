import { IMAGE_STATES, clamp01 } from '../contracts.mjs';

const CONTENT_RULES = [
  ['H2H',/(h2h|head\s*to\s*head|đối đầu)/i],
  ['STANDINGS',/(standings|league\s+table|xếp hạng)/i],
  ['ODDS',/(odds|1x2|handicap|over\/under|tài xỉu|other\s+ht|other\s+ft)/i],
  ['TEAM_HISTORY',/(recent matches|recent form|lịch sử|last\s*\d+\s+matches?)/i],
];

function normalizedText(meta={}){
  return String(meta.visibleText??meta.text??'').replace(/\s+/g,' ').trim();
}

function explicitMatchState(text){
  if(/(countdown|kick\s*off\s*in|starts?\s*in|bắt đầu sau|đếm ngược)/i.test(text)) return 'PREMATCH_COUNTDOWN';
  if(/(half\s*time|halftime|nghỉ giữa hiệp)/i.test(text) || /^(ht)$/i.test(text)) return 'HALFTIME';
  if(/(finished|full\s*time|kết thúc)/i.test(text) || /^(ft)$/i.test(text)) return 'FINISHED';
  if(/(2nd\s*half|second\s*half|hiệp\s*2)/i.test(text) || /\b(?:4[6-9]|[5-8]\d|90)(?:\+\d+)?\s*(?:['’]|min(?:ute)?s?|phút)\b/i.test(text)) return 'LIVE_2H';
  if(/(1st\s*half|first\s*half|hiệp\s*1)/i.test(text) || /\b(?:[1-9]|[1-3]\d|4[0-5])(?:\+\d+)?\s*(?:['’]|min(?:ute)?s?|phút)\b/i.test(text)) return 'LIVE_1H';
  return null;
}

export function classifyImageState(meta={}){
  if(IMAGE_STATES.includes(meta.imageState)) return meta.imageState;
  const text=normalizedText(meta);
  const explicit=explicitMatchState(text);
  if(explicit) return explicit;
  for(const [state,re] of CONTENT_RULES) if(re.test(text)) return state;
  return text ? 'PREMATCH_NORMAL' : 'UNKNOWN';
}

export function normalizeImageEvidence(input={}){
  const imageState=classifyImageState(input);
  const extracted=input.extracted&&typeof input.extracted==='object'?input.extracted:{};
  const visibleFields=Array.isArray(input.visibleFields)?[...new Set(input.visibleFields.map(String))]:[];
  const missingFields=Array.isArray(input.missingFields)?[...new Set(input.missingFields.map(String))]:[];
  const extractedFieldCount=Object.values(extracted).filter(v=>v!==null&&v!==undefined&&(typeof v!=='object'||Object.keys(v).length>0)).length;
  const visualDensity=clamp01(Number(input.visualDensity??(visibleFields.length?Math.min(1,visibleFields.length/8):0)));
  const suspectedFailure=visualDensity>=0.55 && extractedFieldCount===0;
  const liveState=['LIVE_1H','HALFTIME','LIVE_2H','FINISHED'].includes(imageState);
  const strictPriorEligible=!liveState;
  return {
    imageState,
    fixture: input.fixture??null,
    extracted,
    visibleFields,
    missingFields,
    confidence: clamp01(Number(input.confidence??(suspectedFailure?0.1:0.7))),
    source:'USER_IMAGE',
    strictPriorEligible,
    liveEvidenceAllowed: ['LIVE_1H','HALFTIME','LIVE_2H'].includes(imageState),
    prematchEvidenceAllowed: strictPriorEligible,
    suspectedFailure,
    status: suspectedFailure?'IMAGE_EXTRACTION_SUSPECTED_FAILURE':'OK',
  };
}

export function aggregateImageEvidence(images=[]){
  const normalized=images.map(normalizeImageEvidence);
  const prematchRows=normalized.filter(x=>x.strictPriorEligible&&x.prematchEvidenceAllowed);
  const fixture=(prematchRows.map(x=>x.fixture).find(Boolean)??normalized.map(x=>x.fixture).find(Boolean))??null;
  const merged={};
  const provenance={};
  for(let i=0;i<normalized.length;i++){
    const row=normalized[i];
    if(!row.strictPriorEligible || !row.prematchEvidenceAllowed) continue;
    for(const [k,v] of Object.entries(row.extracted)){
      if(v===null||v===undefined) continue;
      if(merged[k]===undefined || (typeof v==='object'&&v&&Object.keys(v).length)){
        merged[k]=v;
        provenance[k]={imageIndex:i,imageState:row.imageState,source:'USER_IMAGE',strictPriorEligible:true};
      }
    }
  }
  const countdown=normalized.some(x=>x.imageState==='PREMATCH_COUNTDOWN');
  const excludedLiveEvidence=normalized.filter(x=>!x.strictPriorEligible&&Object.keys(x.extracted??{}).length>0).length;
  const hardFailures=[];
  if(normalized.some(x=>x.suspectedFailure)) hardFailures.push('IMAGE_EXTRACTION_SUSPECTED_FAILURE');
  if(!fixture?.home||!fixture?.away) hardFailures.push('FIXTURE_IDENTITY_MISSING');
  return {
    fixture: fixture?{...fixture,state:countdown?'PREMATCH_COUNTDOWN':prematchRows[0]?.imageState??normalized[0]?.imageState??'UNKNOWN'}:null,
    extracted:merged,
    provenance,
    images:normalized,
    countdown,
    liveEvidenceUsed:false,
    excludedLiveEvidence,
    hardFailures,
  };
}

const WEIGHTS={fixtureIdentity:20,homeHistory:20,awayHistory:20,h2h:10,standings:10,scoringStats:15,odds:5};
export function evidenceCompleteness(bundle={}){
  const e=bundle.extracted??{};
  const flags={
    fixtureIdentity:Boolean(bundle.fixture?.home&&bundle.fixture?.away),
    homeHistory:Boolean(e.homeHistory||e.formHome),
    awayHistory:Boolean(e.awayHistory||e.formAway),
    h2h:Boolean(e.h2h),
    standings:Boolean(e.standings),
    scoringStats:Boolean(e.scoringStats||e.stats),
    odds:Boolean(e.odds),
  };
  const score=Object.entries(flags).reduce((s,[k,v])=>s+(v?WEIGHTS[k]:0),0);
  const action=score>=80?'FULL':score>=60?'WARN':score>=40?'CONSERVATIVE':'INSUFFICIENT_IMAGE_EVIDENCE';
  return {flags,score,action};
}
