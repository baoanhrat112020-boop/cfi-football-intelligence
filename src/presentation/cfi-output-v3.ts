export const CFI_OUTPUT_V3='CFI_PRACTICAL_OUTPUT_V3';

export type InputMode='IMAGE_ANALYSIS'|'DISCOVER_TOP_MATCHES'|'SINGLE_MATCH';
type Decision='BET'|'LEAN'|'WATCH'|'NO_BET'|'SHADOW'|'BLOCKED';
type Settlement={fullWin:number|null;halfWin:number|null;push:number|null;halfLoss:number|null;fullLoss:number|null;fairDecimal:number|null};
type OddsMeta={bookmaker:string|null;capturedAt:string|null;verified:boolean;fresh:boolean;source:string|null};
type Card={market:string;family:'CHAMPION'|'1X2'|'OVER_UNDER'|'ASIAN_HANDICAP';period:'HT'|'FT'|null;probability:number|null;fairOdds:number|null;marketOdds:number|null;impliedProbability:number|null;edge:number|null;expectedValue:number|null;confidence:string|null;decision:Decision;decisionUse:boolean;researchState:'CHAMPION'|'PROMOTED'|'SHADOW';settlement?:Settlement};

const finite=(v:any)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const round=(v:number|null,d=4)=>{if(v===null)return null;const p=10**d;return Math.round(v*p)/p;};
const fairOdds=(p:number|null)=>p&&p>0?round(1/p,3):null;
const text=(v:any)=>typeof v==='string'&&v.trim()?v.trim():null;
const isoTime=(v:any)=>{const s=text(v);if(!s)return null;const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;};

function normalizeOdds(input:any,nowMs=Date.now()){
  const wrapped=input&&typeof input==='object'&&input.values&&typeof input.values==='object';
  const values=wrapped?input.values:(input&&typeof input==='object'?input:{});
  const rawMeta=wrapped?(input.metadata??{}):{};
  const capturedAt=isoTime(rawMeta.capturedAt??rawMeta.captured_at);
  const ageMs=capturedAt?Math.max(0,nowMs-Date.parse(capturedAt)):null;
  const maxAgeMinutes=Math.max(1,Math.min(240,finite(rawMeta.maxAgeMinutes??rawMeta.max_age_minutes)??30));
  const verified=rawMeta.verified===true&&Boolean(text(rawMeta.bookmaker))&&Boolean(capturedAt);
  const fresh=verified&&ageMs!==null&&ageMs<=maxAgeMinutes*60_000;
  const metadata:OddsMeta={bookmaker:text(rawMeta.bookmaker),capturedAt,verified,fresh,source:text(rawMeta.source)};
  return{values,metadata,ageMinutes:ageMs===null?null:round(ageMs/60_000,1),maxAgeMinutes};
}

function settlementView(raw:any):Settlement|null{
  if(!raw||typeof raw!=='object')return null;
  return{fullWin:finite(raw.fullWin),halfWin:finite(raw.halfWin),push:finite(raw.push),halfLoss:finite(raw.halfLoss),fullLoss:finite(raw.fullLoss),fairDecimal:finite(raw.fairDecimal)};
}

function expectedValue(p:number|null,o:number|null,s:Settlement|null){
  if(o===null||o<=1)return null;
  if(s){
    const fw=s.fullWin??0,hw=s.halfWin??0,hl=s.halfLoss??0,fl=s.fullLoss??0;
    return round(fw*(o-1)+hw*(o-1)/2-hl/2-fl);
  }
  return p===null?null:round(p*o-1);
}

function decide(args:{p:number|null;o:number|null;ev:number|null;confidence:string|null;decisionUse:boolean;researchState:Card['researchState'];qualityPass:boolean;oddsReady:boolean}):Decision{
  if(!args.qualityPass)return 'BLOCKED';
  if(!args.decisionUse||args.researchState==='SHADOW')return 'SHADOW';
  if(args.p===null)return 'NO_BET';
  if(!args.oddsReady||args.o===null)return args.p>=.55?'WATCH':'NO_BET';
  const implied=1/args.o,edge=args.p-implied,confidenceOk=!['LOW','VERY_LOW'].includes(String(args.confidence??'').toUpperCase());
  if(args.ev!==null&&args.ev>=.05&&edge>=.04&&confidenceOk)return 'BET';
  if(args.ev!==null&&args.ev>0&&edge>=.015)return 'LEAN';
  return 'NO_BET';
}

function makeCard(args:{market:string;family:Card['family'];period:Card['period'];probability:any;confidence?:any;odds:any;settlement?:any;decisionUse:boolean;researchState:Card['researchState'];qualityPass:boolean;oddsReady:boolean;fairOverride?:any}):Card{
  const probability=finite(args.probability),marketOdds=finite(args.odds),settlement=settlementView(args.settlement),confidence=text(args.confidence),ev=expectedValue(probability,marketOdds,settlement);
  return{market:args.market,family:args.family,period:args.period,probability,fairOdds:finite(args.fairOverride)??settlement?.fairDecimal??fairOdds(probability),marketOdds,impliedProbability:marketOdds&&marketOdds>0?round(1/marketOdds):null,edge:probability!==null&&marketOdds&&marketOdds>0?round(probability-1/marketOdds):null,expectedValue:ev,confidence,decision:decide({p:probability,o:marketOdds,ev,confidence,decisionUse:args.decisionUse,researchState:args.researchState,qualityPass:args.qualityPass,oddsReady:args.oddsReady}),decisionUse:args.decisionUse,researchState:args.researchState,...(settlement?{settlement}: {})};
}

function multiMarketPolicy(body:any){
  const integration=body?.multiMarketIntegration??{};
  const decisionUse=integration?.decisionUse===true||body?.multiMarket?.decisionUse===true;
  const promoted=decisionUse&&['PROMOTED','PRODUCTION','LIVE'].includes(String(integration?.status??body?.multiMarket?.status??'').toUpperCase());
  return{decisionUse:promoted,researchState:promoted?'PROMOTED' as const:'SHADOW' as const,status:integration?.status??body?.multiMarket?.mode??null};
}

function add1x2(cards:Card[],body:any,values:any,period:'HT'|'FT',policy:ReturnType<typeof multiMarketPolicy>,qualityPass:boolean,oddsReady:boolean){
  const row=body?.multiMarket?.oneXTwo?.[period.toLowerCase()];if(!row)return;
  for(const [side,key] of [['1','home'],['X','draw'],['2','away']] as const){const market=`${period} ${side}`;cards.push(makeCard({market,family:'1X2',period,probability:row[key],odds:values[market],decisionUse:policy.decisionUse,researchState:policy.researchState,qualityPass,oddsReady}));}
}
function addOu(cards:Card[],body:any,values:any,period:'HT'|'FT',policy:ReturnType<typeof multiMarketPolicy>,qualityPass:boolean,oddsReady:boolean){
  const ladder=body?.multiMarket?.overUnder?.[period.toLowerCase()]??{};
  for(const line of Object.keys(ladder).sort((a,b)=>Number(a)-Number(b)))for(const side of ['over','under'] as const){const s=ladder[line]?.[side],market=`${period} ${side==='over'?'O':'U'}${line}`;if(s)cards.push(makeCard({market,family:'OVER_UNDER',period,probability:s.fullWin,odds:values[market],settlement:s,fairOverride:s.fairDecimal,decisionUse:policy.decisionUse,researchState:policy.researchState,qualityPass,oddsReady}));}
}
function addAh(cards:Card[],body:any,values:any,period:'HT'|'FT',policy:ReturnType<typeof multiMarketPolicy>,qualityPass:boolean,oddsReady:boolean){
  const ladder=body?.multiMarket?.asianHandicap?.[period.toLowerCase()]??{};
  for(const line of Object.keys(ladder).sort((a,b)=>Number(a)-Number(b)))for(const side of ['home','away'] as const){const s=ladder[line]?.[side],market=`${period} AH ${side.toUpperCase()} ${line}`;if(s)cards.push(makeCard({market,family:'ASIAN_HANDICAP',period,probability:s.fullWin,odds:values[market],settlement:s,fairOverride:s.fairDecimal,decisionUse:policy.decisionUse,researchState:policy.researchState,qualityPass,oddsReady}));}
}

function renderedReport(mode:InputMode,match:any,cards:Card[],odds:ReturnType<typeof normalizeOdds>){
  const ranked=cards.filter(x=>x.decision==='BET'||x.decision==='LEAN'||x.decision==='WATCH').sort((a,b)=>(b.expectedValue??-9)-(a.expectedValue??-9));
  const lines=[`CFI PRACTICAL OUTPUT V3 — ${mode}`,`${match.home??'—'} vs ${match.away??'—'} | ${match.date??'—'}`,`ODDS: ${odds.metadata.verified&&odds.metadata.fresh?`VERIFIED · ${odds.metadata.bookmaker} · ${odds.metadata.capturedAt}`:'NOT VERIFIED/FRESH'}`,'','TOP DECISIONS'];
  if(!ranked.length)lines.push('NO_BET — không có target vượt đủ gate.');
  else ranked.slice(0,5).forEach((x,i)=>lines.push(`${i+1}. ${x.decision} ${x.market} | P ${x.probability===null?'—':`${(x.probability*100).toFixed(1)}%`} | Odds ${x.marketOdds??'—'} | EV ${x.expectedValue===null?'—':`${(x.expectedValue*100).toFixed(1)}%`}`));
  return lines.join('\n');
}

export function buildCfiOutputV3(body:any,input:any={}){
  const mode=(['IMAGE_ANALYSIS','DISCOVER_TOP_MATCHES','SINGLE_MATCH'].includes(input?.input_mode)?input.input_mode:'SINGLE_MATCH') as InputMode;
  const odds=normalizeOdds(input?.odds??{},finite(input?.now_ms)??Date.now());
  const strictPrior=body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true;
  const consistency=(!body?.consistencyGuard?.status||body.consistencyGuard.status==='PASS')&&(!body?.multiMarket?.consistencyGuard?.status||body.multiMarket.consistencyGuard.status==='PASS');
  const fixtureVerified=input?.fixture_identity?.verified!==false;
  const qualityPass=Boolean(strictPrior&&consistency&&fixtureVerified);
  const oddsReady=odds.metadata.verified&&odds.metadata.fresh;
  const cards:Card[]=(body?.ranking??[]).map((r:any)=>makeCard({market:String(r.target),family:'CHAMPION',period:String(r.target).includes('HT')?'HT':'FT',probability:r.probability,confidence:r.confidence??r.predictiveConfidence,odds:odds.values?.[r.target],decisionUse:true,researchState:'CHAMPION',qualityPass,oddsReady}));
  const policy=multiMarketPolicy(body);
  add1x2(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);add1x2(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  addOu(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);addOu(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  addAh(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);addAh(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  const rank=(xs:Card[])=>xs.sort((a,b)=>(b.expectedValue??-9)-(a.expectedValue??-9)||(b.probability??0)-(a.probability??0));
  const bet=rank(cards.filter(x=>x.decision==='BET')),lean=rank(cards.filter(x=>x.decision==='LEAN')),watch=rank(cards.filter(x=>x.decision==='WATCH'));
  const match={home:body?.target?.home??null,away:body?.target?.away??null,date:body?.target?.date??null};
  const final:Decision=!qualityPass?'BLOCKED':bet.length?'BET':lean.length?'LEAN':watch.length?'WATCH':'NO_BET';
  return{version:CFI_OUTPUT_V3,input:{mode,imageEvidence:mode==='IMAGE_ANALYSIS'?{imageCount:Math.max(0,finite(input?.image_evidence?.image_count)??0),fixtureIdentityVerified:fixtureVerified,extractedFields:Array.isArray(input?.image_evidence?.extracted_fields)?input.image_evidence.extracted_fields:[]}:null},match,final,primary:bet[0]??lean[0]??watch[0]??null,topDecisions:[...bet,...lean,...watch].slice(0,5),decisions:{bet,lean,watch,noBet:cards.filter(x=>x.decision==='NO_BET'),shadow:cards.filter(x=>x.decision==='SHADOW'),blocked:cards.filter(x=>x.decision==='BLOCKED')},champion:{thresholds:cards.filter(x=>x.family==='CHAMPION'),top3HT:body?.scoreline?.ht?.final??[],top3FT:body?.scoreline?.ft?.final??[],path:body?.scoreline?.mostLikelyPath??null},multiMarket:{policy,oneXTwo:cards.filter(x=>x.family==='1X2'),overUnder:cards.filter(x=>x.family==='OVER_UNDER'),asianHandicap:cards.filter(x=>x.family==='ASIAN_HANDICAP')},odds:{...odds.metadata,ageMinutes:odds.ageMinutes,maxAgeMinutes:odds.maxAgeMinutes},gates:{strictPrior,consistency,fixtureIdentityVerified:fixtureVerified,verifiedOdds:odds.metadata.verified,freshOdds:odds.metadata.fresh,betRequiresAllGates:true,noForcedFive:true},rules:{betMinEdge:0.04,betMinExpectedValue:0.05,leanMinEdge:0.015,unverifiedOrStaleOddsCannotBet:true,shadowDecisionUse:false,noGuaranteedWin:true},renderedPracticalReport:renderedReport(mode,match,cards,odds)};
}

export function attachCfiOutputV3(body:any,input:any={}){body.outputV3=buildCfiOutputV3(body,input);return body;}
