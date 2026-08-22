import { MARKETS, assertExpertOutput, clamp01 } from './contracts.mjs';

function normalizeTop3(rows){
  if(!Array.isArray(rows)) return [];
  return rows.slice(0,3).map(x=>typeof x==='string'?x:String(x?.score??'')).filter(Boolean);
}

function requiredProbability(probabilities, market){
  const raw=probabilities?.[market];
  const n=Number(raw);
  if(raw===null||raw===undefined||raw===''||!Number.isFinite(n)||n<0||n>1){
    throw new Error(`INVALID_PROBABILITY:${market}`);
  }
  return n;
}

export function makeExpert(name,{probabilities={},top3HT=[],top3FT=[],confidence={},provenance={}}={}){
  const p=Object.fromEntries(MARKETS.map(m=>[m,requiredProbability(probabilities,m)]));
  const coverageRaw=Number(confidence.coverage??0);
  const sampleRaw=Number(confidence.localSample??0);
  const out={
    expert:name,
    probabilities:p,
    top3HT:normalizeTop3(top3HT),
    top3FT:normalizeTop3(top3FT),
    confidence:{
      coverage:clamp01(Number.isFinite(coverageRaw)?coverageRaw:0),
      localSample:Number.isFinite(sampleRaw)&&sampleRaw>=0?sampleRaw:0,
      ood:Boolean(confidence.ood),
    },
    provenance,
  };
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
