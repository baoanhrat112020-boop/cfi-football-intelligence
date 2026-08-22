import { clamp01 } from './contracts.mjs';

export function conditionalTop3(grid=[],predicate=()=>false){
  const tail=grid.filter(predicate).filter(x=>Number.isFinite(x?.probability)&&x.probability>=0);
  const z=tail.reduce((s,x)=>s+x.probability,0);
  if(!(z>0)) return [];
  return tail.map(x=>({...x,conditionalProbability:x.probability/z})).sort((a,b)=>b.conditionalProbability-a.conditionalProbability).slice(0,3);
}

export function tailConcentration(grid=[],predicate=()=>false){
  const tail=grid.filter(predicate).filter(x=>Number.isFinite(x?.probability)&&x.probability>=0);
  const eventProbability=tail.reduce((s,x)=>s+x.probability,0);
  if(!(eventProbability>0)) return {eventProbability:0,conditionalTop1:0,conditionalTop3Mass:0,entropy:0,exactScoreConfidence:'LOW'};
  const ps=tail.map(x=>x.probability/eventProbability).filter(p=>p>0);
  const sorted=[...ps].sort((a,b)=>b-a);
  const entropy=-ps.reduce((s,p)=>s+p*Math.log(p),0);
  const normalizedEntropy=ps.length>1?entropy/Math.log(ps.length):0;
  const conditionalTop1=sorted[0]??0,conditionalTop3Mass=sorted.slice(0,3).reduce((a,b)=>a+b,0);
  const exactScoreConfidence=conditionalTop3Mass>=.55&&normalizedEntropy<=.65?'HIGH':conditionalTop3Mass>=.35&&normalizedEntropy<=.82?'MEDIUM':'LOW';
  return {eventProbability:clamp01(eventProbability),conditionalTop1,conditionalTop3Mass,entropy:normalizedEntropy,exactScoreConfidence};
}

export function buildTailConditional({htGrid=[],ftGrid=[]}){
  const ht3=x=>Number(x.total??String(x.score).split('-').map(Number).reduce((a,b)=>a+b,0))>=3;
  const ft7=x=>Number(x.total??String(x.score).split('-').map(Number).reduce((a,b)=>a+b,0))>=7;
  const otherHT=x=>{const[h,a]=String(x.score).split('-').map(Number);return h>=4||a>=4;};
  const otherFT=x=>{const[h,a]=String(x.score).split('-').map(Number);return h>=5||a>=5;};
  return {
    top3HTGiven3Plus:conditionalTop3(htGrid,ht3),
    top3FTGiven7Plus:conditionalTop3(ftGrid,ft7),
    top3HTGivenOther:conditionalTop3(htGrid,otherHT),
    top3FTGivenOther:conditionalTop3(ftGrid,otherFT),
    concentration:{
      threePlusHT:tailConcentration(htGrid,ht3),
      sevenPlusFT:tailConcentration(ftGrid,ft7),
      otherHT:tailConcentration(htGrid,otherHT),
      otherFT:tailConcentration(ftGrid,otherFT),
    }
  };
}

export function auditTailGrid({probabilities,htGrid=[],ftGrid=[],tolerance=.05}){
  const tail=buildTailConditional({htGrid,ftGrid});
  const checks=[
    ['3+ HT',tail.concentration.threePlusHT.eventProbability],
    ['7+ FT',tail.concentration.sevenPlusFT.eventProbability],
    ['Other HT',tail.concentration.otherHT.eventProbability],
    ['Other FT',tail.concentration.otherFT.eventProbability],
  ];
  const warnings=checks.flatMap(([m,mass])=>Math.abs(Number(probabilities?.[m])-mass)>tolerance?[`${m}:TAIL_PROBABILITY_GRID_MISMATCH`]:[]);
  return {pass:warnings.length===0,warnings,tail};
}
