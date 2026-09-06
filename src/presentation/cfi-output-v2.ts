import { evaluateThreePlusHtSafety } from '../prediction/three-plus-ht-safety.ts';

export const CFI_OUTPUT_V2='CFI_OUTPUT_V2';

const FULL_MARKET_REPORT_MARKER='CFI MULTI-MARKET FULL BOARD';
type SettlementView={fullWin:number|null;halfWin:number|null;push:number|null;halfLoss:number|null;fullLoss:number|null;fairDecimal:number|null};
type Card={market:string;probability:number|null;fairOdds:number|null;confidence:string|null;status:'BET'|'WATCH'|'PASS'|'SHADOW';marketOdds:number|null;edge:number|null;source:'CHAMPION'|'SHADOW';settlement?:SettlementView|null;decisionUse?:boolean;calibrationStatus?:string|null;rawProbability?:number|null;bettingProbability?:number|null;probabilitySource?:string|null};
const finite=(v:any)=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const fairOdds=(p:number|null)=>p&&p>0?Math.round((1/p)*1000)/1000:null;
const pct=(p:number|null)=>p===null?'—':`${(p*100).toFixed(1)}%`;
const conf=(v:any)=>typeof v==='string'?v:null;
const price=(v:number|null)=>v===null?'—':String(Math.round(v*1000)/1000);

function decision(probability:number|null,marketOdds:number|null,confidence:string|null,shadow=false):Card['status']{
  if(shadow)return 'SHADOW';
  if(probability===null)return 'PASS';
  if(marketOdds===null)return probability>=.55?'WATCH':'PASS';
  const implied=1/marketOdds;
  const edge=probability-implied;
  const confidenceOk=confidence!=='LOW'&&confidence!=='VERY_LOW';
  if(edge>=.05&&confidenceOk)return 'BET';
  if(edge>=.015)return 'WATCH';
  return 'PASS';
}
function card(market:string,probability:any,confidence:any,marketOdds:any,source:Card['source'],shadow=false,fairOverride:any=null,settlement:SettlementView|null=null):Card{
  const p=finite(probability),o=finite(marketOdds),edge=p!==null&&o!==null?p-(1/o):null,fo=finite(fairOverride);
  return {market,probability:p,fairOdds:fo??fairOdds(p),confidence:conf(confidence),status:decision(p,o,conf(confidence),shadow),marketOdds:o,edge:edge===null?null:Math.round(edge*10000)/10000,source,...(settlement?{settlement}: {})};
}
function settlementView(s:any):SettlementView|null{
  if(!s||typeof s!=='object')return null;
  return {fullWin:finite(s.fullWin),halfWin:finite(s.halfWin),push:finite(s.push),halfLoss:finite(s.halfLoss),fullLoss:finite(s.fullLoss),fairDecimal:finite(s.fairDecimal)};
}
function add1x2(shadow:Card[],mm:any,odds:any,part:'HT'|'FT'){
  const x=mm?.oneXTwo?.[part.toLowerCase()];if(!x)return;
  shadow.push(card(`${part} 1`,x.home,null,odds?.[`${part} 1`],'SHADOW',true));
  shadow.push(card(`${part} X`,x.draw,null,odds?.[`${part} X`],'SHADOW',true));
  shadow.push(card(`${part} 2`,x.away,null,odds?.[`${part} 2`],'SHADOW',true));
}
function addOu(shadow:Card[],mm:any,odds:any,part:'HT'|'FT'){
  const ladder=mm?.overUnder?.[part.toLowerCase()]??{};
  for(const line of Object.keys(ladder).sort((a,b)=>Number(a)-Number(b))){
    for(const side of ['over','under'] as const){
      const s=settlementView(ladder[line]?.[side]);if(!s)continue;
      const label=`${part} ${side==='over'?'O':'U'}${line}`;
      shadow.push(card(label,s.fullWin,null,odds?.[label],'SHADOW',true,s.fairDecimal,s));
    }
  }
}
function addAh(shadow:Card[],mm:any,odds:any,part:'HT'|'FT'){
  const ladder=mm?.asianHandicap?.[part.toLowerCase()]??{};
  for(const line of Object.keys(ladder).sort((a,b)=>Number(a)-Number(b))){
    for(const side of ['home','away'] as const){
      const s=settlementView(ladder[line]?.[side]);if(!s)continue;
      const label=`${part} AH ${side.toUpperCase()} ${line}`;
      shadow.push(card(label,s.fullWin,null,odds?.[label],'SHADOW',true,s.fairDecimal,s));
    }
  }
}
function oneXTwoLine(rows:Card[],part:'HT'|'FT'){
  const get=(side:'1'|'X'|'2')=>rows.find(x=>x.market===`${part} ${side}`);
  const h=get('1'),d=get('X'),a=get('2');
  return `${part} 1X2: 1 ${pct(h?.probability??null)} | X ${pct(d?.probability??null)} | 2 ${pct(a?.probability??null)}`;
}
function pairedLadderLines(rows:Card[],part:'HT'|'FT',family:'OU'|'AH'){
  if(family==='OU'){
    const lines=[...new Set(rows.map(x=>x.market.match(/^[A-Z]+ [OU](-?\d+(?:\.\d+)?)$/)?.[1]).filter(Boolean) as string[])].sort((a,b)=>Number(a)-Number(b));
    return lines.map(line=>{
      const o=rows.find(x=>x.market===`${part} O${line}`),u=rows.find(x=>x.market===`${part} U${line}`);
      return `${part} O/U ${line}: O ${pct(o?.probability??null)} (fair ${price(o?.fairOdds??null)}) | U ${pct(u?.probability??null)} (fair ${price(u?.fairOdds??null)})`;
    });
  }
  const lines=[...new Set(rows.map(x=>x.market.match(/ AH (?:HOME|AWAY) (-?\d+(?:\.\d+)?)$/)?.[1]).filter(Boolean) as string[])].sort((a,b)=>Number(a)-Number(b));
  return lines.map(line=>{
    const home=rows.find(x=>x.market===`${part} AH HOME ${line}`);
    const away=rows.find(x=>x.market===`${part} AH AWAY ${line}`);
    return `${part} AH ${line}: HOME ${pct(home?.probability??null)} (fair ${price(home?.fairOdds??null)}) | AWAY ${pct(away?.probability??null)} (fair ${price(away?.fairOdds??null)})`;
  });
}
function fullMarketReport(body:any,groups:any){
  const status=String(body?.multiMarketIntegration?.status??body?.multiMarket?.status??'SHADOW_RESEARCH');
  const oneHt=groups.oneXTwo.ht as Card[],oneFt=groups.oneXTwo.ft as Card[],ouHt=groups.overUnder.ht as Card[],ouFt=groups.overUnder.ft as Card[],ahHt=groups.asianHandicap.ht as Card[],ahFt=groups.asianHandicap.ft as Card[];
  return [
    `${FULL_MARKET_REPORT_MARKER} — ${body?.multiMarket?.version??'CFI_MULTI_MARKET_V1'}`,
    `STATUS: ${status} | decisionUse=false | Champion mutation=false`,
    '',
    '1X2 — FULL',
    oneXTwoLine(oneHt,'HT'),
    oneXTwoLine(oneFt,'FT'),
    '',
    'OVER/UNDER HT — FULL LADDER',
    ...pairedLadderLines(ouHt,'HT','OU'),
    '',
    'OVER/UNDER FT — FULL LADDER',
    ...pairedLadderLines(ouFt,'FT','OU'),
    '',
    'ASIAN HANDICAP HT — FULL LADDER',
    ...pairedLadderLines(ahHt,'HT','AH'),
    '',
    'ASIAN HANDICAP FT — FULL LADDER',
    ...pairedLadderLines(ahFt,'FT','AH'),
    '',
    'NOTE: all new markets are visible; SHADOW status remains fail-closed until promotion gates pass.'
  ].join('\n');
}

function applyThreePlusHtSafety(row:Card,safety:ReturnType<typeof evaluateThreePlusHtSafety>){
  if(row.market!=='3+ HT')return row;
  row.rawProbability=safety.rawFinalProbability;
  row.bettingProbability=safety.bettingProbability;
  row.calibrationStatus=safety.status;
  row.decisionUse=safety.decisionUse;
  row.probabilitySource=safety.decisionUse?'CALIBRATED_3PLUS_HT':'FINAL_AUDIT_ONLY';
  if(!safety.decisionUse){
    row.status='WATCH';
    row.edge=null;
    return row;
  }
  const p=safety.bettingProbability;
  row.probability=p;
  row.fairOdds=fairOdds(p);
  row.edge=p!==null&&row.marketOdds!==null?Math.round((p-1/row.marketOdds)*10000)/10000:null;
  row.status=decision(p,row.marketOdds,row.confidence,false);
  return row;
}

export function buildCfiOutputV2(body:any,odds:any={}){
  const threePlusHtSafety=evaluateThreePlusHtSafety(body);
  const champion=(body?.ranking??[]).map((r:any)=>applyThreePlusHtSafety(card(r.target,r.probability,r.confidence,odds?.[r.target],'CHAMPION'),threePlusHtSafety));
  const mm=body?.multiMarket;
  const shadow:Card[]=[];
  add1x2(shadow,mm,odds,'HT');add1x2(shadow,mm,odds,'FT');
  addOu(shadow,mm,odds,'HT');addOu(shadow,mm,odds,'FT');
  addAh(shadow,mm,odds,'HT');addAh(shadow,mm,odds,'FT');
  const all=[...champion,...shadow];
  const actionable=all.filter(x=>x.status==='BET').sort((a,b)=>(b.edge??-9)-(a.edge??-9));
  const watch=all.filter(x=>x.status==='WATCH').sort((a,b)=>(b.probability??0)-(a.probability??0));
  const best=actionable[0]??watch[0]??champion[0]??null;
  const top1ht=body?.scoreline?.primaryTop1?.ht?.final??body?.primaryTargetMatrix?.exactScore?.['Top-1 HT']?.final??(Array.isArray(body?.scoreline?.ht?.final)?body.scoreline.ht.final[0]:body?.scoreline?.ht?.final)??null;
  const top1ft=body?.scoreline?.primaryTop1?.ft?.final??body?.primaryTargetMatrix?.exactScore?.['Top-1 FT']?.final??(Array.isArray(body?.scoreline?.ft?.final)?body.scoreline.ft.final[0]:body?.scoreline?.ft?.final)??null;
  const marketGroups={
    oneXTwo:{ht:shadow.filter(x=>/^HT [1X2]$/.test(x.market)),ft:shadow.filter(x=>/^FT [1X2]$/.test(x.market))},
    overUnder:{ht:shadow.filter(x=>/^HT [OU]/.test(x.market)),ft:shadow.filter(x=>/^FT [OU]/.test(x.market))},
    asianHandicap:{ht:shadow.filter(x=>/^HT AH /.test(x.market)),ft:shadow.filter(x=>/^FT AH /.test(x.market))},
  };
  const report=fullMarketReport(body,marketGroups);
  const headlineMessage=best?.market==='3+ HT'&&!threePlusHtSafety.decisionUse
    ?`WATCH 3+ HT · RAW FINAL ${pct(threePlusHtSafety.rawFinalProbability)} · ${threePlusHtSafety.status} · betting P —`
    :best?`${best.status} ${best.market} · P ${pct(best.probability)} · Fair ${best.fairOdds??'—'}${best.marketOdds?` · Market ${best.marketOdds}`:''}`:'No qualified market';
  return {
    version:CFI_OUTPUT_V2,
    contract:body?.primaryTargetMatrix?.contract??body?.primaryTargets?.contract??'CFI_2_METHODS_X_6_TARGETS_V2',
    match:{home:body?.target?.home??null,away:body?.target?.away??null,date:body?.target?.date??null},
    headline:{status:best?.status??'PASS',market:best?.market??null,probability:best?.probability??null,fairOdds:best?.fairOdds??null,marketOdds:best?.marketOdds??null,edge:best?.edge??null,message:headlineMessage},
    quickDecision:{bet:actionable,watch,pass:all.filter(x=>x.status==='PASS'),shadow:all.filter(x=>x.status==='SHADOW')},
    championMarkets:champion,
    shadowMarkets:shadow,
    threePlusHtSafety,
    marketGroups,
    fullMarketReport:report,
    visibility:{
      fullMultiMarketVisible:true,
      allTargetsExposed:true,
      decisionUse:false,
      status:body?.multiMarketIntegration?.status??mm?.status??'SHADOW_RESEARCH',
      counts:{oneXTwoHT:marketGroups.oneXTwo.ht.length,oneXTwoFT:marketGroups.oneXTwo.ft.length,overUnderHT:marketGroups.overUnder.ht.length,overUnderFT:marketGroups.overUnder.ft.length,asianHandicapHT:marketGroups.asianHandicap.ht.length,asianHandicapFT:marketGroups.asianHandicap.ft.length},
    },
    scoreline:{top1HT:top1ht,top1FT:top1ft,path:body?.scoreline?.mostLikelyPath??null},
    expectedGoals:body?.scoreline?.expectedGoals??null,
    quality:{strictPrior:body?.strictPrior?.verified??body?.strictPriorAudit?.evidence?.verified??null,consistency:body?.consistencyGuard?.status??null,multiMarketConsistency:mm?.consistencyGuard?.status??null,uncertainty:body?.scoreline?.uncertainty??null,multiMarketStatus:body?.multiMarketIntegration?.status??null},
    rules:{betRequiresOdds:true,minModelEdge:0.05,watchEdge:0.015,noGuaranteedWin:true,shadowDecisionUse:false,quarterAndIntegerLinesExposeSettlementStates:true,threePlusHtRawFinalIsAuditOnly:true,threePlusHtRequiresApprovedCalibration:true,threePlusHtRequiresCrossCoreEquivalence:true},
  };
}

export function attachCfiOutputV2(body:any,odds:any={}){
  const output=buildCfiOutputV2(body,odds);
  body.outputV2=output;
  body.threePlusHtSafety=output.threePlusHtSafety;
  body.fullMarketReport=output.fullMarketReport;
  if(typeof body?.renderedReport==='string'&&output.fullMarketReport&&!body.renderedReport.includes(FULL_MARKET_REPORT_MARKER))body.renderedReport=`${body.renderedReport}\n\n${output.fullMarketReport}`;
  body.presentation={...(body.presentation??{}),fullMultiMarketVisible:true,allTargetsExposed:true,multiMarketDecisionUse:false,primaryScorelineOutput:'TOP1_HT_PLUS_TOP1_FT',fullMarketReportSource:'fullMarketReport',threePlusHtBettingPolicy:output.threePlusHtSafety.status};
  return body;
}
