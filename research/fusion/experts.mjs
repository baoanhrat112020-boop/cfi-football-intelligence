import { MARKETS, assertExpertOutput, clamp01 } from './contracts.mjs';

function normalizeTop3(rows){
  if(!Array.isArray(rows)) return [];
  return rows.slice(0,3).map(x=>typeof x==='string'?x:String(x?.score??'')).filter(Boolean);
}

export function makeExpert(name,{probabilities={},top3HT=[],top3FT=[],confidence={},provenance={}}={}){
  const p=Object.fromEntries(MARKETS.map(m=>[m,clamp01(Number(probabilities[m]))]));
  const out={expert:name,probabilities:p,top3HT:normalizeTop3(top3HT),top3FT:normalizeTop3(top3FT),confidence:{coverage:clamp01(Number(confidence.coverage??0)),localSample:Math.max(0,Number(confidence.localSample??0)),ood:Boolean(confidence.ood)},provenance};
  assertExpertOutput(out);
  return out;
}

export const futureSixExpert = input => makeExpert('FUTURE_SIX',input);
export const historicalExpert = input => makeExpert('HISTORICAL',input);
export const matchDnaExpert = input => makeExpert('MATCH_DNA',input);
export const regimeExpert = input => makeExpert('REGIME',input);

export function buildExpertCouncil({futureSix,historical,dna,regime}){
  const council={
    FUTURE_SIX:futureSixExpert(futureSix),
    HISTORICAL:historicalExpert(historical),
    MATCH_DNA:matchDnaExpert(dna),
    REGIME:regimeExpert(regime),
  };
  return Object.freeze(council);
}
