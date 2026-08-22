export const CFI_OUTPUT_V2='CFI_OUTPUT_V2';

type Card={market:string;probability:number|null;fairOdds:number|null;confidence:string|null;status:'BET'|'WATCH'|'PASS'|'SHADOW';marketOdds:number|null;edge:number|null;source:'CHAMPION'|'SHADOW'};
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
function card(market:string,probability:any,confidence:any,marketOdds:any,source:Card['source'],shadow=false):Card{
  const p=finite(probability),o=finite(marketOdds),edge=p!==null&&o!==null?p-(1/o):null;
  return {market,probability:p,fairOdds:fairOdds(p),confidence:conf(confidence),status:decision(p,o,conf(confidence),shadow),marketOdds:o,edge:edge===null?null:Math.round(edge*10000)/10000,source};
}

export function buildCfiOutputV2(body:any,odds:any={}){
  const champion=(body?.ranking??[]).map((r:any)=>card(r.target,r.probability,r.confidence,odds?.[r.target],'CHAMPION'));
  const mm=body?.multiMarket;
  const shadow:Card[]=[];
  if(mm?.oneXTwo?.ft){
    shadow.push(card('FT 1',mm.oneXTwo.ft.home,null,odds?.['FT 1'],'SHADOW',true));
    shadow.push(card('FT X',mm.oneXTwo.ft.draw,null,odds?.['FT X'],'SHADOW',true));
    shadow.push(card('FT 2',mm.oneXTwo.ft.away,null,odds?.['FT 2'],'SHADOW',true));
  }
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
    scoreline:{top3HT:top3ht,top3FT:top3ft,path:body?.scoreline?.mostLikelyPath??null},
    expectedGoals:body?.scoreline?.expectedGoals??null,
    quality:{strictPrior:body?.strictPrior?.verified??body?.strictPriorAudit?.evidence?.verified??null,consistency:body?.consistencyGuard?.status??null,uncertainty:body?.scoreline?.uncertainty??null,multiMarketStatus:body?.multiMarketIntegration?.status??null},
    rules:{betRequiresOdds:true,minModelEdge:0.05,watchEdge:0.015,noGuaranteedWin:true,shadowDecisionUse:false},
  };
}

export function attachCfiOutputV2(body:any,odds:any={}){body.outputV2=buildCfiOutputV2(body,odds);return body;}
