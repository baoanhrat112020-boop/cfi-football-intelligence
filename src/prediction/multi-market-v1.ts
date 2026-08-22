export const MULTI_MARKET_VERSION = 'CFI_MULTI_MARKET_V1';
export const MULTI_MARKET_STATUS = 'SHADOW_RESEARCH';

type ScoreCell = { home:number; away:number; total:number; probability:number };
type Settlement = { fullWin:number; halfWin:number; push:number; halfLoss:number; fullLoss:number; fairDecimal:number|null };

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const round=(x:number)=>Math.round(x*1e12)/1e12;

function poisson(lambda:number,max:number){
  const out:number[]=[];
  let p=Math.exp(-lambda),sum=0;
  out.push(p);sum+=p;
  for(let k=1;k<=max;k++){p=p*lambda/k;out.push(p);sum+=p;}
  if(sum<=0)return out;
  return out.map(x=>x/sum);
}

export function buildIndependentScoreGrid(homeLambda:number,awayLambda:number,maxGoals=12):ScoreCell[]{
  if(!Number.isFinite(homeLambda)||!Number.isFinite(awayLambda)||homeLambda<0||awayLambda<0)throw new Error('INVALID_EXPECTED_GOALS');
  const h=poisson(homeLambda,maxGoals),a=poisson(awayLambda,maxGoals),grid:ScoreCell[]=[];
  let z=0;
  for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++){const probability=h[i]*a[j];grid.push({home:i,away:j,total:i+j,probability});z+=probability;}
  return grid.map(r=>({...r,probability:r.probability/z}));
}

function oneXTwo(grid:ScoreCell[]){
  let home=0,draw=0,away=0;
  for(const r of grid){if(r.home>r.away)home+=r.probability;else if(r.home<r.away)away+=r.probability;else draw+=r.probability;}
  return {home:round(home),draw:round(draw),away:round(away)};
}

function splitQuarterLine(line:number){
  const q=Math.round(line*4)/4;
  const frac=Math.abs(q-Math.trunc(q));
  if(Math.abs(frac-.25)<1e-9||Math.abs(frac-.75)<1e-9)return [q-.25,q+.25] as const;
  return [q,q] as const;
}

function classify(x:number){return x>1e-9?'WIN':x<-1e-9?'LOSS':'PUSH';}
function settlement(grid:ScoreCell[],line:number,difference:(r:ScoreCell,l:number)=>number):Settlement{
  const [a,b]=splitQuarterLine(line);let fullWin=0,halfWin=0,push=0,halfLoss=0,fullLoss=0;
  for(const row of grid){
    const x=classify(difference(row,a)),y=classify(difference(row,b)),p=row.probability;
    if(x==='WIN'&&y==='WIN')fullWin+=p;
    else if(x==='LOSS'&&y==='LOSS')fullLoss+=p;
    else if(x==='PUSH'&&y==='PUSH')push+=p;
    else if((x==='WIN'&&y==='PUSH')||(x==='PUSH'&&y==='WIN'))halfWin+=p;
    else if((x==='LOSS'&&y==='PUSH')||(x==='PUSH'&&y==='LOSS'))halfLoss+=p;
    else if((x==='WIN'&&y==='LOSS')||(x==='LOSS'&&y==='WIN'))push+=p;
  }
  const winUnits=fullWin+.5*halfWin,lossUnits=fullLoss+.5*halfLoss;
  const fairDecimal=winUnits>0?1+lossUnits/winUnits:null;
  return {fullWin:round(fullWin),halfWin:round(halfWin),push:round(push),halfLoss:round(halfLoss),fullLoss:round(fullLoss),fairDecimal:fairDecimal===null?null:round(fairDecimal)};
}

function totals(grid:ScoreCell[],lines:number[]){
  return Object.fromEntries(lines.map(line=>[String(line),{
    over:settlement(grid,line,(r,l)=>r.total-l),
    under:settlement(grid,line,(r,l)=>l-r.total),
  }]));
}

function asianHandicap(grid:ScoreCell[],lines:number[]){
  return Object.fromEntries(lines.map(line=>[String(line),{
    home:settlement(grid,line,(r,l)=>(r.home-r.away)+l),
    away:settlement(grid,-line,(r,l)=>(r.away-r.home)+l),
  }]));
}

function sumSettlement(s:Settlement){return s.fullWin+s.halfWin+s.push+s.halfLoss+s.fullLoss;}
function consistency(one:any,htTotals:any,ftTotals:any,htAh:any,ftAh:any){
  const violations:string[]=[];
  if(Math.abs(one.ft.home+one.ft.draw+one.ft.away-1)>1e-9)violations.push('FT_1X2_SUM');
  if(Math.abs(one.ht.home+one.ht.draw+one.ht.away-1)>1e-9)violations.push('HT_1X2_SUM');
  const monotonic=(obj:any,label:string)=>{
    const entries=Object.entries(obj).filter(([k])=>Math.abs(Number(k)*2-Math.round(Number(k)*2))<1e-9&&Math.abs(Number(k)%1-.5)<1e-9).sort((a,b)=>Number(a[0])-Number(b[0]));
    let prev=1;
    for(const [k,v] of entries as any){const p=v.over.fullWin;if(p>prev+1e-10)violations.push(`${label}_OVER_MONOTONIC_${k}`);prev=p;}
  };
  monotonic(htTotals,'HT');monotonic(ftTotals,'FT');
  if(Math.abs(ftAh['-0.5']?.home?.fullWin-one.ft.home)>1e-9)violations.push('FT_HOME_MINUS_HALF_NE_1X2_HOME');
  if(Math.abs(htAh['-0.5']?.home?.fullWin-one.ht.home)>1e-9)violations.push('HT_HOME_MINUS_HALF_NE_1X2_HOME');
  for(const [group,obj] of [['HT_OU',htTotals],['FT_OU',ftTotals],['HT_AH',htAh],['FT_AH',ftAh]] as const){for(const [line,sides] of Object.entries(obj) as any)for(const [side,s] of Object.entries(sides) as any)if(Math.abs(sumSettlement(s)-1)>1e-9)violations.push(`${group}_${line}_${side}_SETTLEMENT_SUM`);}
  return {status:violations.length?'FAIL':'PASS',violations};
}

export function buildMultiMarketV1(input:{htHome:number;htAway:number;ftHome:number;ftAway:number}){
  const htGrid=buildIndependentScoreGrid(input.htHome,input.htAway,10);
  const ftGrid=buildIndependentScoreGrid(input.ftHome,input.ftAway,14);
  const one={ht:oneXTwo(htGrid),ft:oneXTwo(ftGrid)};
  const htTotals=totals(htGrid,[0.5,1,1.5,2,2.5,3,3.5,4,4.5]);
  const ftTotals=totals(ftGrid,[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5]);
  const lines=[-2,-1.75,-1.5,-1.25,-1,-.75,-.5,-.25,0,.25,.5,.75,1,1.25,1.5,1.75,2];
  const htAh=asianHandicap(htGrid,lines),ftAh=asianHandicap(ftGrid,lines);
  const guard=consistency(one,htTotals,ftTotals,htAh,ftAh);
  return {
    version:MULTI_MARKET_VERSION,
    status:MULTI_MARKET_STATUS,
    decisionUse:false,
    promotionRequired:true,
    model:{family:'INDEPENDENT_POISSON_SCORE_GRID_V1',source:'existing CFI expected-goal telemetry',maxGoals:{ht:10,ft:14}},
    oneXTwo:one,
    overUnder:{ht:htTotals,ft:ftTotals},
    asianHandicap:{ht:htAh,ft:ftAh},
    derivedChecks:{ftOver6_5:(ftTotals['6.5'] as any).over.fullWin,htOver2_5:(htTotals['2.5'] as any).over.fullWin},
    consistencyGuard:guard,
  };
}
