export const CFI_BETTING_BOARD_VERSION='CFI_BETTING_BOARD_V1';

type Card={market:string;probability:number|null;fairOdds:number|null;confidence:string|null;status:'BET'|'WATCH'|'PASS'|'SHADOW';marketOdds:number|null;edge:number|null;source:'CHAMPION'|'SHADOW'};
type BoardRow=Card&{tier:'A_BEST_VALUE'|'B_GOOD_WATCH'|'C_HIGH_RISK_EXTREME'|'D_PASS'|'SHADOW';risk:'LOW'|'MEDIUM'|'HIGH'|'EXTREME';stakeUnits:number;kellyFraction:number|null;reason:string};

const finite=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
const round=(x:number,d=3)=>{const p=10**d;return Math.round(x*p)/p;};
const extremeMarket=(market:string)=>['3+ HT','7+ FT','Other HT','Other FT'].includes(market);

function riskOf(c:Card):BoardRow['risk']{
  if(extremeMarket(c.market))return c.probability!==null&&c.probability>=.35?'HIGH':'EXTREME';
  if(c.probability===null)return 'HIGH';
  if(c.probability>=.62)return 'LOW';
  if(c.probability>=.48)return 'MEDIUM';
  return 'HIGH';
}
function kelly(c:Card){
  const p=c.probability,o=c.marketOdds;
  if(p===null||o===null||o<=1)return null;
  const b=o-1,q=1-p;
  return round(Math.max(0,(b*p-q)/b),4);
}
function stake(c:Card,risk:BoardRow['risk']){
  if(c.status!=='BET')return 0;
  const k=kelly(c)??0;
  const quarterKelly=k*.25;
  const cap=risk==='LOW'?1.5:risk==='MEDIUM'?1.25:risk==='HIGH'?.75:.5;
  return round(clamp(quarterKelly*10,0,cap),2);
}
function classify(c:Card):BoardRow{
  if(c.status==='SHADOW')return {...c,tier:'SHADOW',risk:'HIGH',stakeUnits:0,kellyFraction:null,reason:'Research-only market; decision use is locked.'};
  const risk=riskOf(c),k=kelly(c),stakeUnits=stake(c,risk),edge=c.edge??-1;
  if(c.status==='BET'&&edge>=.08&&risk!=='EXTREME')return {...c,tier:'A_BEST_VALUE',risk,stakeUnits,kellyFraction:k,reason:'Strong qualified edge with acceptable risk.'};
  if(c.status==='BET'||c.status==='WATCH')return {...c,tier:'B_GOOD_WATCH',risk,stakeUnits,kellyFraction:k,reason:c.status==='BET'?'Qualified positive edge.':'Potential value, but current gate is not strong enough to bet.'};
  if(extremeMarket(c.market)&&(c.probability??0)>=.08)return {...c,tier:'C_HIGH_RISK_EXTREME',risk,stakeUnits:0,kellyFraction:k,reason:'High-payout tail market; monitor only unless value gate qualifies.'};
  return {...c,tier:'D_PASS',risk,stakeUnits:0,kellyFraction:k,reason:'No sufficient value signal.'};
}

export function buildCfiBettingBoard(outputV2:any){
  const cards:Card[]=[...(outputV2?.championMarkets??[]),...(outputV2?.shadowMarkets??[])];
  const rows=cards.map(classify);
  const rank=(tier:BoardRow['tier'])=>rows.filter(r=>r.tier===tier).sort((a,b)=>(b.edge??-9)-(a.edge??-9));
  const A=rank('A_BEST_VALUE'),B=rank('B_GOOD_WATCH'),C=rank('C_HIGH_RISK_EXTREME'),D=rank('D_PASS'),shadow=rank('SHADOW');
  const primary=A[0]??B.find(r=>r.status==='BET')??B[0]??C[0]??null;
  return {
    version:CFI_BETTING_BOARD_VERSION,
    match:outputV2?.match??null,
    primary:primary?{market:primary.market,tier:primary.tier,status:primary.status,probability:primary.probability,fairOdds:primary.fairOdds,marketOdds:primary.marketOdds,edge:primary.edge,risk:primary.risk,stakeUnits:primary.stakeUnits}:null,
    sections:{A_bestValue:A,B_goodWatch:B,C_highRiskExtreme:C,D_pass:D,shadow},
    bankrollPolicy:{unitDefinition:'1 unit = user-defined fixed fraction of bankroll',stakeMethod:'quarter-Kelly capped by risk',maxUnitsPerBet:1.5,noMartingale:true,noChasingLosses:true},
    safety:{betRequiresQualifiedEdge:true,shadowCannotBet:true,noGuaranteedWin:true,stakeIsRiskBudgetNotProfitPromise:true},
  };
}

export function attachCfiBettingBoard(body:any){body.bettingBoard=buildCfiBettingBoard(body?.outputV2);return body;}
