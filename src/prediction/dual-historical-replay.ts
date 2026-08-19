import { buildFinalPrediction, type CanonicalFixture } from './final-engine.ts';
import { buildFutureSixPrediction, FUTURE_SIX_VERSION } from './future-six.ts';

export const DUAL_REPLAY_VERSION='CFI_DUAL_HIST_REPLAY_V1';
export const MODEL_A='HISTORICAL_PRODUCTION';
export const MODEL_B='FUTURE_SIX_FACTORS';
export const PRIMARY_TARGETS=['3+ HT','7+ FT','Other HT','Other FT','Top-3 HT','Top-3 FT'] as const;
export type ModelType=typeof MODEL_A|typeof MODEL_B;

const day=(v:string)=>String(v).slice(0,10);
export function strictPriorFor(target:CanonicalFixture,all:CanonicalFixture[]){
  const t=day(target.matchDate);
  return all.filter(x=>x.fixtureId!==target.fixtureId && day(x.matchDate)<t);
}
export function actuals(f:CanonicalFixture){
  if(!f.ht||!f.ft)return null;
  return {'3+ HT':f.ht.home+f.ht.away>=3,'7+ FT':f.ft.home+f.ft.away>=7,'Other HT':f.ht.home>=4||f.ht.away>=4,'Other FT':f.ft.home>=5||f.ft.away>=5,ht:`${f.ht.home}-${f.ht.away}`,ft:`${f.ft.home}-${f.ft.away}`};
}
const brier=(p:number,y:boolean)=>(p-(y?1:0))**2;
const bin=(p:number)=>`${Math.floor(Math.max(0,Math.min(.999999,p))*10)*10}-${Math.floor(Math.max(0,Math.min(.999999,p))*10)*10+10}%`;
function topEval(rows:any[]|undefined,score:string){const top=(rows||[]).slice(0,3);const i=top.findIndex(x=>x?.score===score);return {top1_hit:i===0,top3_hit:i>=0,rank_of_hit:i>=0?i+1:null};}

export function evaluateFixture(target:CanonicalFixture,all:CanonicalFixture[],meta:{competitionId?:string;segment?:string}={}){
  const truth=actuals(target); if(!truth)return [];
  const prior=strictPriorFor(target,all);
  const homePayload={fixtures:prior.filter(x=>[x.homeTeam.toLowerCase(),x.awayTeam.toLowerCase()].includes(target.homeTeam.toLowerCase()))};
  const awayPayload={fixtures:prior.filter(x=>[x.homeTeam.toLowerCase(),x.awayTeam.toLowerCase()].includes(target.awayTeam.toLowerCase()))};
  const h2hPayload={fixtures:prior.filter(x=>new Set([x.homeTeam.toLowerCase(),x.awayTeam.toLowerCase()]).has(target.homeTeam.toLowerCase())&&new Set([x.homeTeam.toLowerCase(),x.awayTeam.toLowerCase()]).has(target.awayTeam.toLowerCase()))};
  const a:any=buildFinalPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,homePayload,awayPayload,h2hPayload});
  const b:any=buildFutureSixPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,homePayload,awayPayload,h2hPayload});
  const base={fixture_id:target.fixtureId,target_date:day(target.matchDate),competition_id:meta.competitionId??null,segment:meta.segment??'UNKNOWN',home_team:target.homeTeam,away_team:target.awayTeam,replay_version:DUAL_REPLAY_VERSION,prior_sample:prior.length};
  const out:any[]=[];
  for(const market of ['3+ HT','7+ FT','Other HT','Other FT'] as const){
    const pa=Number(a.markets?.[market]?.final); const pb=Number(b.marketSignals?.[market]); const y=truth[market];
    out.push({...base,model_type:MODEL_A,model_version:a.version??a.engine??'CURRENT_PRODUCTION',market,predicted_probability:pa,actual_boolean:y,brier:brier(pa,y),hit:(pa>=.5)===y,calibration_bin:bin(pa)});
    out.push({...base,model_type:MODEL_B,model_version:FUTURE_SIX_VERSION,market,predicted_probability:pb,actual_boolean:y,brier:brier(pb,y),hit:(pb>=.5)===y,calibration_bin:bin(pb),factor_probabilities:Object.fromEntries(Object.entries(b.factors||{}).map(([k,v]:any)=>[k,v.probability])),factor_confidence:Object.fromEntries(Object.entries(b.factors||{}).map(([k,v]:any)=>[k,v.confidence])),factor_evidence:Object.fromEntries(Object.entries(b.factors||{}).map(([k,v]:any)=>[k,{sampleSize:v.sampleSize,evidence:v.evidence}]))});
  }
  const ah=topEval(a.scoreline?.ht,truth.ht), af=topEval(a.scoreline?.ft,truth.ft);
  out.push({...base,model_type:MODEL_A,model_version:a.version??a.engine??'CURRENT_PRODUCTION',market:'Top-3 HT',...ah});
  out.push({...base,model_type:MODEL_A,model_version:a.version??a.engine??'CURRENT_PRODUCTION',market:'Top-3 FT',...af});
  out.push({...base,model_type:MODEL_B,model_version:FUTURE_SIX_VERSION,market:'Top-3 HT',status:'NOT_YET_MODELED'});
  out.push({...base,model_type:MODEL_B,model_version:FUTURE_SIX_VERSION,market:'Top-3 FT',status:'NOT_YET_MODELED'});
  return out;
}

export function* chronologicalReplay(fixtures:CanonicalFixture[]){
  const rows=[...fixtures].sort((a,b)=>day(a.matchDate).localeCompare(day(b.matchDate))||a.fixtureId.localeCompare(b.fixtureId));
  for(const target of rows) if(target.ht&&target.ft) yield evaluateFixture(target,rows);
}
