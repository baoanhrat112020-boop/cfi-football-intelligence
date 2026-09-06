export const CFI_OUTPUT_V3='CFI_PRACTICAL_OUTPUT_V3';
import { evaluateEvidenceSufficiency } from '../prediction/evidence-sufficiency.ts';
import { evaluateThreePlusHtSafety } from '../prediction/three-plus-ht-safety.ts';

export type InputMode='IMAGE_ANALYSIS'|'DISCOVER_TOP_MATCHES'|'SINGLE_MATCH';
type Decision='BET'|'LEAN'|'WATCH'|'NO_BET'|'SHADOW'|'BLOCKED';
type Settlement={fullWin:number|null;halfWin:number|null;push:number|null;halfLoss:number|null;fullLoss:number|null;fairDecimal:number|null};
type OddsMeta={bookmaker:string|null;capturedAt:string|null;verified:boolean;fresh:boolean;source:string|null};
type Card={market:string;family:'CHAMPION'|'1X2'|'OVER_UNDER'|'ASIAN_HANDICAP';period:'HT'|'FT'|null;probability:number|null;fairOdds:number|null;marketOdds:number|null;impliedProbability:number|null;edge:number|null;edgeType:'PROBABILITY_POINTS'|'FAIR_PRICE_RELATIVE';expectedValue:number|null;confidence:string|null;decision:Decision;decisionUse:boolean;researchState:'CHAMPION'|'PROMOTED'|'SHADOW';settlement?:Settlement;calibrationStatus?:string|null;rawProbability?:number|null;bettingProbability?:number|null;probabilitySource?:string|null};

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
  const ageMs=capturedAt?nowMs-Date.parse(capturedAt):null;
  const maxAgeMinutes=Math.max(1,Math.min(240,finite(rawMeta.maxAgeMinutes??rawMeta.max_age_minutes)??30));
  const verified=rawMeta.verified===true&&Boolean(text(rawMeta.bookmaker))&&Boolean(capturedAt);
  const fresh=verified&&ageMs!==null&&ageMs>=-120_000&&ageMs<=maxAgeMinutes*60_000;
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

function decide(args:{p:number|null;o:number|null;edge:number|null;ev:number|null;confidence:string|null;decisionUse:boolean;researchState:Card['researchState'];qualityPass:boolean;oddsReady:boolean}):Decision{
  if(!args.qualityPass)return 'BLOCKED';
  if(!args.decisionUse||args.researchState==='SHADOW')return 'SHADOW';
  if(args.p===null)return 'NO_BET';
  if(!args.oddsReady||args.o===null)return args.p>=.55?'WATCH':'NO_BET';
  const edge=args.edge??-1,confidenceOk=!['LOW','VERY_LOW'].includes(String(args.confidence??'').toUpperCase());
  if(args.ev!==null&&args.ev>=.05&&edge>=.04&&confidenceOk)return 'BET';
  if(args.ev!==null&&args.ev>0&&edge>=.015)return 'LEAN';
  return 'NO_BET';
}

function makeCard(args:{market:string;family:Card['family'];period:Card['period'];probability:any;confidence?:any;odds:any;settlement?:any;decisionUse:boolean;researchState:Card['researchState'];qualityPass:boolean;oddsReady:boolean;fairOverride?:any}):Card{
  const probability=finite(args.probability),marketOdds=finite(args.odds),settlement=settlementView(args.settlement),confidence=text(args.confidence),fo=finite(args.fairOverride)??settlement?.fairDecimal??fairOdds(probability),ev=expectedValue(probability,marketOdds,settlement);
  const edge=marketOdds&&marketOdds>0?(settlement&&fo?round(marketOdds/fo-1):probability!==null?round(probability-1/marketOdds):null):null;
  const edgeType=settlement?'FAIR_PRICE_RELATIVE' as const:'PROBABILITY_POINTS' as const;
  return{market:args.market,family:args.family,period:args.period,probability,fairOdds:fo,marketOdds,impliedProbability:marketOdds&&marketOdds>0?round(1/marketOdds):null,edge,edgeType,expectedValue:ev,confidence,decision:decide({p:probability,o:marketOdds,edge,ev,confidence,decisionUse:args.decisionUse,researchState:args.researchState,qualityPass:args.qualityPass,oddsReady:args.oddsReady}),decisionUse:args.decisionUse,researchState:args.researchState,...(settlement?{settlement}: {})};
}

function multiMarketPolicy(body:any){
  const integration=body?.multiMarketIntegration??{};
  const decisionUse=integration?.decisionUse===true||body?.multiMarket?.decisionUse===true;
  const promoted=decisionUse&&['PROMOTED','PRODUCTION','LIVE'].includes(String(integration?.status??body?.multiMarket?.status??'').toUpperCase());
  return{decisionUse:promoted,researchState:promoted?'PROMOTED' as const:'SHADOW' as const,status:integration?.status??body?.multiMarket?.mode??null};
}

function championFusionView(body:any){
  const f=body?.championFusion;if(!f)return null;
  return{version:f.version??null,lineage:f.lineage??null,status:f.status??null,researchOnly:f.researchOnly!==false,decisionUse:f.decisionUse===true,productionEligible:f.productionEligible===true,activeExperts:f.activeExperts??[],candidateExperts:f.candidateExperts??{},gating:f.gating??null,fusion:f.fusion??null,uncertainty:f.uncertainty??null,strictPrior:f.strictPrior??null,champion:f.champion??null,oneXTwo:f?.multiMarket?.oneXTwo??null,overUnder:f?.multiMarket?.overUnder??null,asianHandicap:f?.multiMarket?.asianHandicap??null,consistencyGuard:f?.multiMarket?.consistencyGuard??null,reason:f.reason??null};
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

function oneXTwoSummary(cards:Card[],period:'HT'|'FT'){
  const rows=cards.filter(x=>x.family==='1X2'&&x.period===period);
  const get=(side:'1'|'X'|'2')=>rows.find(x=>x.market===`${period} ${side}`)??null;
  const home=get('1'),draw=get('X'),away=get('2');
  const pick=[home,draw,away].filter(Boolean).sort((a,b)=>(b!.probability??-1)-(a!.probability??-1))[0]??null;
  return{home,draw,away,modelPick:pick?.market??null,modelProbability:pick?.probability??null,decisionUse:rows.some(x=>x.decisionUse)};
}
function expectedTotals(body:any,period:'HT'|'FT'){
  const e=body?.scoreline?.expectedGoals??{},prefix=period==='HT'?'ht':'ft';
  const home=finite(e?.[`${prefix}Home`]),away=finite(e?.[`${prefix}Away`]);
  return{home,away,total:home===null||away===null?null:round(home+away,3)};
}
function ouSummary(body:any,cards:Card[],period:'HT'|'FT'){
  const projected=expectedTotals(body,period),rows=cards.filter(x=>x.family==='OVER_UNDER'&&x.period===period);
  const lineRows=rows.map(row=>{const m=row.market.match(/[OU](-?\d+(?:\.\d+)?)$/);return{row,line:m?Number(m[1]):NaN};}).filter(x=>Number.isFinite(x.line));
  const halfLines=[...new Set(lineRows.filter(x=>Math.abs(x.line%1)===.5).map(x=>x.line))];
  const available=halfLines.length?halfLines:[...new Set(lineRows.map(x=>x.line))];
  const priced=available.filter(line=>rows.some(x=>(x.market===`${period} O${line}`||x.market===`${period} U${line}`)&&x.marketOdds!==null));
  const candidates=priced.length?priced:available;
  const mainLine=candidates.sort((a,b)=>Math.abs(a-(projected.total??a))-Math.abs(b-(projected.total??b)))[0]??null;
  const over=mainLine===null?null:rows.find(x=>x.market===`${period} O${mainLine}`)??null;
  const under=mainLine===null?null:rows.find(x=>x.market===`${period} U${mainLine}`)??null;
  const lean=[over,under].filter(Boolean).sort((a,b)=>(b!.probability??-1)-(a!.probability??-1))[0]??null;
  return{projectedGoals:projected,mainLine,lineSource:priced.length?'MARKET_ODDS':'MODEL_CENTER',over,under,modelLean:lean?.market??null,modelProbability:lean?.probability??null,decisionUse:rows.some(x=>x.decisionUse)};
}
function ahSummary(body:any,cards:Card[],period:'HT'|'FT'){
  const projected=expectedTotals(body,period),rows=cards.filter(x=>x.family==='ASIAN_HANDICAP'&&x.period===period);
  const difference=projected.home===null||projected.away===null?null:round(projected.home-projected.away,3);
  const homeLine=difference===null?null:Math.max(-2,Math.min(2,Math.round(-difference*4)/4));
  const awayLine=homeLine===null?null:-homeLine;
  const home=homeLine===null?null:rows.find(x=>x.market===`${period} AH HOME ${homeLine}`)??null;
  const away=awayLine===null?null:rows.find(x=>x.market===`${period} AH AWAY ${awayLine}`)??null;
  const lean=[home,away].filter(Boolean).sort((a,b)=>(a!.fairOdds??999)-(b!.fairOdds??999))[0]??null;
  return{projectedGoalDifference:difference,homeModelLine:homeLine,awayModelLine:awayLine,home,away,modelLean:lean?.market??null,decisionUse:rows.some(x=>x.decisionUse)};
}
function marketSummary(body:any,cards:Card[]){return{oneXTwo:{ht:oneXTwoSummary(cards,'HT'),ft:oneXTwoSummary(cards,'FT')},overUnder:{ht:ouSummary(body,cards,'HT'),ft:ouSummary(body,cards,'FT')},asianHandicap:{ht:ahSummary(body,cards,'HT'),ft:ahSummary(body,cards,'FT')}};}

function thresholdProbability(body:any,period:'ht'|'ft',goals:number){
  const line=String(goals-.5),row=body?.multiMarket?.overUnder?.[period]?.[line]?.over;
  return finite(row?.fullWin);
}

function scoreTotal(score:unknown){
  const match=String(score??'').match(/^(\d+)-(\d+)$/);
  return match?Number(match[1])+Number(match[2]):null;
}

function explosionScenario(body:any,evidence:ReturnType<typeof evaluateEvidenceSufficiency>){
  const ht=Object.fromEntries([2,3,4,5].map(goals=>[`${goals}Plus`,thresholdProbability(body,'ht',goals)]));
  const ft=Object.fromEntries([3,4,5,6,7,8].map(goals=>[`${goals}Plus`,thresholdProbability(body,'ft',goals)]));
  const trajectories=Array.isArray(body?.k048TrajectoryShadow?.topTrajectories)?body.k048TrajectoryShadow.topTrajectories:[];
  const highScoringPaths=trajectories.filter((row:any)=>scoreTotal(row?.ft)>=5).slice(0,5).map((row:any)=>({ht:row.ht??null,ft:row.ft??null,probability:finite(row.probability)}));
  const p4=finite((ft as any)['4Plus']),p5=finite((ft as any)['5Plus']),p6=finite((ft as any)['6Plus']),ht3=finite((ht as any)['3Plus']);
  const otherFt=finite(body?.markets?.['Other FT']?.final),uncertainty=String(body?.scoreline?.uncertainty??'UNKNOWN').toUpperCase();
  const level=p6!==null&&p6>=.25?'EXTREME':p5!==null&&p5>=.3?'HIGH':p4!==null&&p4>=.45?'ELEVATED':'BASELINE';
  const triggers:string[]=[],contraSignals:string[]=[];
  if(ht3!==null&&ht3>=.35)triggers.push('HIGH_HT_TEMPO');
  if(p5!==null&&p5>=.3)triggers.push('FT_TAIL_5_PLUS');
  if(otherFt!==null&&otherFt>=.15)triggers.push('ONE_SIDED_COLLAPSE_RISK');
  if(highScoringPaths.length)triggers.push('K048_HIGH_SCORE_PATH_PRESENT');
  if(!evidence.decisionEligible)contraSignals.push('THIN_EXACT_TEAM_EVIDENCE');
  if(uncertainty==='HIGH')contraSignals.push('HIGH_SCORELINE_UNCERTAINTY');
  if(p5!==null&&p5<.2)contraSignals.push('LOW_FT_5_PLUS_MASS');
  return{version:'CFI_EXPLOSION_SCENARIO_V1',level,decisionUse:evidence.decisionEligible,expectedGoals:{ht:expectedTotals(body,'HT'),ft:expectedTotals(body,'FT')},thresholds:{ht,ft},baselinePath:body?.scoreline?.mostLikelyPath??null,highScoringPaths,triggers,contraSignals,interpretation:'Scenario probabilities are model distribution mass, not a guaranteed match script.'};
}

function renderedReport(mode:InputMode,match:any,cards:Card[],odds:ReturnType<typeof normalizeOdds>,summary:ReturnType<typeof marketSummary>,evidence:ReturnType<typeof evaluateEvidenceSufficiency>,explosion:ReturnType<typeof explosionScenario>,ledger:any,fusion:any,threePlusHtSafety:ReturnType<typeof evaluateThreePlusHtSafety>){
  const ranked=cards.filter(x=>x.decision==='BET'||x.decision==='LEAN'||x.decision==='WATCH').sort((a,b)=>(b.expectedValue??-9)-(a.expectedValue??-9));
  const lines=[`CFI PRACTICAL OUTPUT V3 — ${mode}`,`${match.home??'—'} vs ${match.away??'—'} | ${match.date??'—'}`,`ODDS: ${odds.metadata.verified&&odds.metadata.fresh?`VERIFIED · ${odds.metadata.bookmaker} · ${odds.metadata.capturedAt}`:'NOT VERIFIED/FRESH'}`,'','TOP DECISIONS'];
  if(!ranked.length)lines.push('NO_BET — không có target vượt đủ gate.');
  else ranked.slice(0,5).forEach((x,i)=>lines.push(`${i+1}. ${x.decision} ${x.market} | P ${x.probability===null?'—':`${(x.probability*100).toFixed(1)}%`} | Odds ${x.marketOdds??'—'} | EV ${x.expectedValue===null?'—':`${(x.expectedValue*100).toFixed(1)}%`}`));
  lines.push('',`3+ HT SAFETY: ${threePlusHtSafety.status} | RAW FINAL ${threePlusHtSafety.rawFinalProbability===null?'—':`${(threePlusHtSafety.rawFinalProbability*100).toFixed(1)}%`} | FUTURE SIX ${threePlusHtSafety.futureSixChallengerProbability===null?'—':`${(threePlusHtSafety.futureSixChallengerProbability*100).toFixed(1)}%`} | HT O2.5 ${threePlusHtSafety.scoreGridProbability===null?'—':`${(threePlusHtSafety.scoreGridProbability*100).toFixed(1)}%`} | betting P ${threePlusHtSafety.bettingProbability===null?'—':`${(threePlusHtSafety.bettingProbability*100).toFixed(1)}%`} | decisionUse=${threePlusHtSafety.decisionUse?'true':'false'}`);
  lines.push('',`EVIDENCE: ${evidence.status} | HOME ${evidence.homeFixtures} | AWAY ${evidence.awayFixtures} | required ${evidence.requiredPerTeam}/team`);
  lines.push('',`BET LEDGER: ${ledger.status} | explicit confirmation required | auto-placed: NO`);
  for(const period of ['HT','FT'] as const){const x=summary.oneXTwo[period.toLowerCase() as 'ht'|'ft'],ou=summary.overUnder[period.toLowerCase() as 'ht'|'ft'],ah=summary.asianHandicap[period.toLowerCase() as 'ht'|'ft'];lines.push('',`${period} 1X2: ${x.modelPick??'—'} ${x.modelProbability===null?'—':`${(x.modelProbability*100).toFixed(1)}%`}`,`${period} TOTAL: ${ou.projectedGoals.total??'—'} | O/U line ${ou.mainLine??'—'} | lean ${ou.modelLean??'—'} ${ou.modelProbability===null?'—':`${(ou.modelProbability*100).toFixed(1)}%`}`,`${period} AH: goal diff ${ah.projectedGoalDifference??'—'} | model line ${ah.homeModelLine??'—'} | lean ${ah.modelLean??'—'}`);}
  if(fusion)lines.push('',`CHAMPION FUSION: ${fusion.status??'—'} | SHADOW | confidence ${finite(fusion?.uncertainty?.confidence)===null?'—':`${(Number(fusion.uncertainty.confidence)*100).toFixed(1)}%`} | abstain ${fusion?.uncertainty?.abstain===true?'YES':'NO'} | decisionUse=false`);
  lines.push('',`EXPLOSION: ${explosion.level} | FT 4+ ${finite((explosion.thresholds.ft as any)['4Plus'])===null?'—':`${(Number((explosion.thresholds.ft as any)['4Plus'])*100).toFixed(1)}%`} | FT 5+ ${finite((explosion.thresholds.ft as any)['5Plus'])===null?'—':`${(Number((explosion.thresholds.ft as any)['5Plus'])*100).toFixed(1)}%`} | FT 6+ ${finite((explosion.thresholds.ft as any)['6Plus'])===null?'—':`${(Number((explosion.thresholds.ft as any)['6Plus'])*100).toFixed(1)}%`}`);
  return lines.join('\n');
}

export function buildCfiOutputV3(body:any,input:any={}){
  const mode=(['IMAGE_ANALYSIS','DISCOVER_TOP_MATCHES','SINGLE_MATCH'].includes(input?.input_mode)?input.input_mode:'SINGLE_MATCH') as InputMode;
  const odds=normalizeOdds(input?.odds??{},finite(input?.now_ms)??Date.now());
  const strictPrior=body?.strictPrior?.verified===true||body?.strictPriorAudit?.evidence?.verified===true;
  const consistency=(!body?.consistencyGuard?.status||body.consistencyGuard.status==='PASS')&&(!body?.multiMarket?.consistencyGuard?.status||body.multiMarket.consistencyGuard.status==='PASS');
  const fixtureVerified=mode==='IMAGE_ANALYSIS'||mode==='DISCOVER_TOP_MATCHES'?input?.fixture_identity?.verified===true:input?.fixture_identity?.verified!==false;
  const evidenceSufficiency=evaluateEvidenceSufficiency(body);
  const qualityPass=Boolean(strictPrior&&consistency&&fixtureVerified&&evidenceSufficiency.decisionEligible);
  const oddsReady=odds.metadata.verified&&odds.metadata.fresh;
  const threePlusHtSafety=evaluateThreePlusHtSafety(body);
  const cards:Card[]=(body?.ranking??[]).map((r:any)=>{
    const market=String(r.target),isThreePlusHt=market==='3+ HT';
    const modelProbability=isThreePlusHt&&threePlusHtSafety.bettingProbability!==null?threePlusHtSafety.bettingProbability:r.probability;
    const c=makeCard({market,family:'CHAMPION',period:market.includes('HT')?'HT':'FT',probability:modelProbability,confidence:r.confidence??r.predictiveConfidence,odds:odds.values?.[r.target],decisionUse:isThreePlusHt?threePlusHtSafety.decisionUse:true,researchState:'CHAMPION',qualityPass,oddsReady});
    if(isThreePlusHt){
      c.rawProbability=threePlusHtSafety.rawFinalProbability;
      c.bettingProbability=threePlusHtSafety.bettingProbability;
      c.calibrationStatus=threePlusHtSafety.status;
      c.probabilitySource=threePlusHtSafety.decisionUse?'CALIBRATED_3PLUS_HT':'FINAL_AUDIT_ONLY';
      if(!threePlusHtSafety.decisionUse){
        c.probability=threePlusHtSafety.rawFinalProbability;
        c.fairOdds=null;
        c.edge=null;c.expectedValue=null;c.decisionUse=false;
        c.decision=qualityPass?'WATCH':'BLOCKED';
      }
    }
    return c;
  });
  const policy=multiMarketPolicy(body);
  add1x2(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);add1x2(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  addOu(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);addOu(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  addAh(cards,body,odds.values,'HT',policy,qualityPass,oddsReady);addAh(cards,body,odds.values,'FT',policy,qualityPass,oddsReady);
  const rank=(xs:Card[])=>xs.sort((a,b)=>(b.expectedValue??-9)-(a.expectedValue??-9)||(b.probability??0)-(a.probability??0));
  const bet=rank(cards.filter(x=>x.decision==='BET')),lean=rank(cards.filter(x=>x.decision==='LEAN')),watch=rank(cards.filter(x=>x.decision==='WATCH'));
  const match={home:body?.target?.home??null,away:body?.target?.away??null,date:body?.target?.date??null};
  const final:Decision=!qualityPass?'BLOCKED':bet.length?'BET':lean.length?'LEAN':watch.length?'WATCH':'NO_BET';
  const summary=marketSummary(body,cards);
  const explosion=explosionScenario(body,evidenceSufficiency);
  const fusion=championFusionView(body);
  const primary=bet[0]??lean[0]??watch[0]??null;
  const betLedger={version:'CFI_USER_BET_LEDGER_V1',status:'NOT_RECORDED',endpoint:'/api/bets',explicitConfirmationRequired:true,autoPlaced:false,candidate:primary?{market:primary.market,probability:primary.probability,odds:primary.marketOdds,decision:primary.decision}:null,requiredFields:['market_family','period','selection','line','odds','stake','bookmaker','confirmed_by_user=true'],note:'CFI chỉ ghi nhận sau khi người dùng xác nhận; CFI không tự đặt cược.'};
  return{version:CFI_OUTPUT_V3,input:{mode,imageEvidence:mode==='IMAGE_ANALYSIS'?{imageCount:Math.max(0,finite(input?.image_evidence?.image_count)??0),fixtureIdentityVerified:fixtureVerified,extractedFields:Array.isArray(input?.image_evidence?.extracted_fields)?input.image_evidence.extracted_fields:[]}:null},match,final,primary,topDecisions:[...bet,...lean,...watch].slice(0,5),decisions:{bet,lean,watch,noBet:cards.filter(x=>x.decision==='NO_BET'),shadow:cards.filter(x=>x.decision==='SHADOW'),blocked:cards.filter(x=>x.decision==='BLOCKED')},champion:{thresholds:cards.filter(x=>x.family==='CHAMPION'),top3HT:body?.scoreline?.ht?.final??[],top3FT:body?.scoreline?.ft?.final??[],path:body?.scoreline?.mostLikelyPath??null},championFusion:fusion,threePlusHtSafety,marketSummary:summary,explosionScenario:explosion,evidenceSufficiency,betLedger,multiMarket:{policy,oneXTwo:cards.filter(x=>x.family==='1X2'),overUnder:cards.filter(x=>x.family==='OVER_UNDER'),asianHandicap:cards.filter(x=>x.family==='ASIAN_HANDICAP')},odds:{...odds.metadata,ageMinutes:odds.ageMinutes,maxAgeMinutes:odds.maxAgeMinutes},gates:{strictPrior,consistency,fixtureIdentityVerified:fixtureVerified,evidenceSufficient:evidenceSufficiency.decisionEligible,verifiedOdds:odds.metadata.verified,freshOdds:odds.metadata.fresh,threePlusHtCalibration:threePlusHtSafety.status,threePlusHtCrossCore:threePlusHtSafety.crossCore.status,betRequiresAllGates:true,noForcedFive:true},rules:{betMinEdge:0.04,betMinExpectedValue:0.05,leanMinEdge:0.015,minEvidenceFixturesPerTeam:evidenceSufficiency.requiredPerTeam,unverifiedOrStaleOddsCannotBet:true,shadowDecisionUse:false,threePlusHtRawFinalIsAuditOnly:true,threePlusHtRequiresApprovedCalibration:true,threePlusHtRequiresCrossCoreEquivalence:true,noGuaranteedWin:true},renderedPracticalReport:renderedReport(mode,match,cards,odds,summary,evidenceSufficiency,explosion,betLedger,fusion,threePlusHtSafety)};
}

export function attachCfiOutputV3(body:any,input:any={}){body.outputV3=buildCfiOutputV3(body,input);body.threePlusHtSafety=body.outputV3.threePlusHtSafety;return body;}
