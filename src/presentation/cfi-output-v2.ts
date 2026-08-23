export const CFI_OUTPUT_V2='CFI_OUTPUT_V2';

type SettlementView={fullWin:number|null;halfWin:number|null;push:number|null;halfLoss:number|null;fullLoss:number|null;fairDecimal:number|null};
type Card={market:string;probability:number|null;fairOdds:number|null;confidence:string|null;status:'BET'|'WATCH'|'PASS'|'SHADOW';marketOdds:number|null;edge:number|null;source:'CHAMPION'|'SHADOW';settlement?:SettlementView|null};
const finite=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
const fairOdds=(p:number|null)=>p&&p>0?Math.round((1/p)*1000)/1000:null;
const pct=(p:number|null)=>p===null?'—':`${(p*100).toFixed(1)}%`;
const conf=(v:any)=>typeof v==='string'?v:null;

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

export function buildCfiOutputV2(body:any,odds:any={}){
  const champion=(body?.ranking??[]).map((r:any)=>card(r.target,r.probability,r.confidence,odds?.[r.target],'CHAMPION'));
  const mm=body?.multiMarket;
  const shadow:Card[]=[];
  add1x2(shadow,mm,odds,'HT');add1x2(shadow,mm,odds,'FT');
  addOu(shadow,mm,odds,'HT');addOu(shadow,mm,odds,'FT');
  addAh(shadow,mm,odds,'HT');addAh(shadow,mm,odds,'FT');
  const all=[...champion,...shadow];
  const actionable=all.filter(x=>x.status==='BET').sort((a,b)=>(b.edge??-9)-(a.edge??-9));
  const watch=all.filter(x=>x.status==='WATCH').sort((a,b)=>(b.probability??0)-(a.probability??0));
  const best=actionable[0]??watch[0]??champion[0]??null;
  const top3ht=body?.scoreline?.ht?.final??[];
  const top3ft=body?.scoreline?.ft?.final??[];
  return {
    version:CFI_OUTPUT_V2,
    match:{home:body?.target?.home??null,away:body?.target?.away??null,date:body?.target?.date??null},
    headline:{status:best?.status??'PASS',market:best?.market??null,probability:best?.probability??null,fairOdds:best?.fairOdds??null,marketOdds:best?.marketOdds??null,edge:best?.edge??null,message:best?`${best.status} ${best.market} · P ${pct(best.probability)} · Fair ${best.fairOdds??'—'}${best.marketOdds?` · Market ${best.marketOdds}`:''}`:'No qualified market'},
    quickDecision:{bet:actionable,watch,pass:all.filter(x=>x.status==='PASS'),shadow:all.filter(x=>x.status==='SHADOW')},
    championMarkets:champion,
    shadowMarkets:shadow,
    marketGroups:{
      oneXTwo:{ht:shadow.filter(x=>/^HT [1X2]$/.test(x.market)),ft:shadow.filter(x=>/^FT [1X2]$/.test(x.market))},
      overUnder:{ht:shadow.filter(x=>/^HT [OU]/.test(x.market)),ft:shadow.filter(x=>/^FT [OU]/.test(x.market))},
      asianHandicap:{ht:shadow.filter(x=>/^HT AH /.test(x.market)),ft:shadow.filter(x=>/^FT AH /.test(x.market))},
    },
    scoreline:{top3HT:top3ht,top3FT:top3ft,path:body?.scoreline?.mostLikelyPath??null},
    expectedGoals:body?.scoreline?.expectedGoals??null,
    quality:{strictPrior:body?.strictPrior?.verified??body?.strictPriorAudit?.evidence?.verified??null,consistency:body?.consistencyGuard?.status??null,multiMarketConsistency:mm?.consistencyGuard?.status??null,uncertainty:body?.scoreline?.uncertainty??null,multiMarketStatus:body?.multiMarketIntegration?.status??null},
    rules:{betRequiresOdds:true,minModelEdge:0.05,watchEdge:0.015,noGuaranteedWin:true,shadowDecisionUse:false,quarterAndIntegerLinesExposeSettlementStates:true},
  };
}

export function attachCfiOutputV2(body:any,odds:any={}){body.outputV2=buildCfiOutputV2(body,odds);return body;}
