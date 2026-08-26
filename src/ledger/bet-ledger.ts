export const CFI_BET_LEDGER_VERSION='CFI_USER_BET_LEDGER_V1';
export type BetFamily='CHAMPION'|'1X2'|'OVER_UNDER'|'ASIAN_HANDICAP';
export type BetPeriod='HT'|'FT';
export type BetSelection='HOME'|'DRAW'|'AWAY'|'OVER'|'UNDER'|'3+ HT'|'7+ FT'|'Other HT'|'Other FT';
export type BetSettlementState='FULL_WIN'|'HALF_WIN'|'PUSH'|'HALF_LOSS'|'FULL_LOSS';

const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;
const clean=(value:unknown)=>String(value??'').trim();
const date=(value:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value));
const instant=(value:unknown)=>Number.isFinite(Date.parse(clean(value)));

export function validateBetRecord(input:any){
  const errors:string[]=[];
  const family=clean(input?.market_family).toUpperCase() as BetFamily;
  const period=clean(input?.period).toUpperCase() as BetPeriod;
  const selection=clean(input?.selection).toUpperCase() as BetSelection;
  if(input?.confirmed_by_user!==true)errors.push('EXPLICIT_USER_CONFIRMATION_REQUIRED');
  if(!date(input?.target_date))errors.push('TARGET_DATE_REQUIRED');
  if(!clean(input?.home)||!clean(input?.away)||clean(input?.home).toLowerCase()===clean(input?.away).toLowerCase())errors.push('DISTINCT_HOME_AWAY_REQUIRED');
  if(!['CHAMPION','1X2','OVER_UNDER','ASIAN_HANDICAP'].includes(family))errors.push('MARKET_FAMILY_INVALID');
  if(!['HT','FT'].includes(period))errors.push('PERIOD_INVALID');
  if(!['HOME','DRAW','AWAY','OVER','UNDER','3+ HT','7+ FT','OTHER HT','OTHER FT'].includes(selection))errors.push('SELECTION_INVALID');
  if(!clean(input?.market))errors.push('MARKET_REQUIRED');
  if(family==='1X2'&&!['HOME','DRAW','AWAY'].includes(selection))errors.push('1X2_SELECTION_INVALID');
  if(family==='OVER_UNDER'&&!['OVER','UNDER'].includes(selection))errors.push('OVER_UNDER_SELECTION_INVALID');
  if(family==='ASIAN_HANDICAP'&&!['HOME','AWAY'].includes(selection))errors.push('ASIAN_HANDICAP_SELECTION_INVALID');
  if(family==='CHAMPION'&&!['3+ HT','7+ FT','OTHER HT','OTHER FT'].includes(selection))errors.push('CHAMPION_SELECTION_INVALID');
  if(['3+ HT','OTHER HT'].includes(selection)&&period!=='HT')errors.push('CHAMPION_PERIOD_MISMATCH');
  if(['7+ FT','OTHER FT'].includes(selection)&&period!=='FT')errors.push('CHAMPION_PERIOD_MISMATCH');
  if((family==='OVER_UNDER'||family==='ASIAN_HANDICAP')&&finite(input?.line)===null)errors.push('LINE_REQUIRED');
  if(finite(input?.odds)===null||Number(input.odds)<=1)errors.push('DECIMAL_ODDS_INVALID');
  if(finite(input?.stake)===null||Number(input.stake)<=0)errors.push('STAKE_INVALID');
  if(!clean(input?.bookmaker))errors.push('BOOKMAKER_REQUIRED');
  if(!instant(input?.confirmed_at))errors.push('CONFIRMED_AT_REQUIRED');
  return{valid:errors.length===0,errors,normalized:{version:CFI_BET_LEDGER_VERSION,targetDate:clean(input?.target_date),home:clean(input?.home),away:clean(input?.away),marketFamily:family,market:clean(input?.market),period,selection,line:finite(input?.line),odds:finite(input?.odds),stake:finite(input?.stake),bookmaker:clean(input?.bookmaker),confirmedAt:new Date(clean(input?.confirmed_at)).toISOString(),predictionSnapshotId:clean(input?.prediction_snapshot_id)||null,sourceUrl:clean(input?.source_url)||null,manualOverride:input?.manual_override===true,notes:clean(input?.notes)||null}};
}

function splitQuarterLine(line:number){
  const quarters=Math.round(line*4);
  return Math.abs(quarters)%2===1?[(quarters-1)/4,(quarters+1)/4]:[line,line];
}
function leg(value:number){return value>1e-9?'WIN':value<-1e-9?'LOSS':'PUSH';}
function combine(a:string,b:string):BetSettlementState{
  const states=[a,b].sort().join('|');
  if(states==='WIN|WIN')return'FULL_WIN';if(states==='PUSH|WIN')return'HALF_WIN';if(states==='PUSH|PUSH')return'PUSH';if(states==='LOSS|PUSH')return'HALF_LOSS';return'FULL_LOSS';
}

export function settleBet(input:any,result:{htHome:number;htAway:number;ftHome:number;ftAway:number}){
  const checked=validateBetRecord({...input,confirmed_by_user:true});
  if(!checked.valid)throw new Error(`INVALID_BET:${checked.errors.join(',')}`);
  const bet=checked.normalized,h=bet.period==='HT'?result.htHome:result.ftHome,a=bet.period==='HT'?result.htAway:result.ftAway;
  if(![h,a].every(x=>Number.isInteger(x)&&x>=0))throw new Error('VERIFIED_SCORE_REQUIRED');
  let state:BetSettlementState;
  if(bet.marketFamily==='CHAMPION'){
    const won=bet.selection==='3+ HT'?result.htHome+result.htAway>=3:bet.selection==='7+ FT'?result.ftHome+result.ftAway>=7:bet.selection==='OTHER HT'?result.htHome>=4||result.htAway>=4:bet.selection==='OTHER FT'?result.ftHome>=5||result.ftAway>=5:false;
    state=won?'FULL_WIN':'FULL_LOSS';
  }else if(bet.marketFamily==='1X2'){
    const actual=h>a?'HOME':h<a?'AWAY':'DRAW';state=bet.selection===actual?'FULL_WIN':'FULL_LOSS';
  }else{
    const line=Number(bet.line),legs=splitQuarterLine(line);
    const values=legs.map(x=>bet.marketFamily==='OVER_UNDER'?(bet.selection==='OVER'?h+a-x:x-(h+a)):(bet.selection==='HOME'?h-a+x:a-h+x));
    state=combine(leg(values[0]),leg(values[1]));
  }
  const stake=Number(bet.stake),odds=Number(bet.odds);
  const profit=state==='FULL_WIN'?stake*(odds-1):state==='HALF_WIN'?stake*(odds-1)/2:state==='PUSH'?0:state==='HALF_LOSS'?-stake/2:-stake;
  return{state,profit:Math.round(profit*100)/100,returnAmount:Math.round((stake+profit)*100)/100,result:{ht:`${result.htHome}-${result.htAway}`,ft:`${result.ftHome}-${result.ftAway}`}};
}
