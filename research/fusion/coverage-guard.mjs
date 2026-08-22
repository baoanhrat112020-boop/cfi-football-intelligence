import { clamp01 } from './contracts.mjs';

export function assessCoverage(ctx={}){
  const reasons=[];
  const homePrior=Number(ctx.homePriorMatches??0),awayPrior=Number(ctx.awayPriorMatches??0),dna=Number(ctx.dnaNeighbors??0);
  if(homePrior<10) reasons.push('LOW_HOME_HISTORY');
  if(awayPrior<10) reasons.push('LOW_AWAY_HISTORY');
  if(dna<20) reasons.push('LOW_DNA_SUPPORT');
  if(String(ctx.segment??'UNKNOWN')==='UNKNOWN') reasons.push('UNKNOWN_SEGMENT');
  const databaseHistory=clamp01(Math.min(homePrior,awayPrior)/30);
  const imageCompleteness=clamp01(Number(ctx.imageCompleteness??1));
  const dnaSupport=clamp01(dna/100);
  const regimeSupport=clamp01(Number(ctx.regimeSupport??0.5));
  const score=clamp01(.35*databaseHistory+.25*imageCompleteness+.25*dnaSupport+.15*regimeSupport);
  return {score,ood:score<.5,reasons,databaseHistory,imageCompleteness,dnaSupport,regimeSupport};
}
