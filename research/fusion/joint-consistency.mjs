import { MARKETS } from './contracts.mjs';

export function validateProbabilityMonotonicity(probabilities={}){
  const warnings=[];
  for(const m of MARKETS){
    const p=probabilities[m];
    if(!Number.isFinite(p)||p<0||p>1) warnings.push(`${m}:INVALID_PROBABILITY`);
  }
  if(Number.isFinite(probabilities['Other HT'])&&Number.isFinite(probabilities['3+ HT'])&&probabilities['Other HT']>probabilities['3+ HT']+.02) warnings.push('OTHER_HT_EXCEEDS_3PLUS_HT');
  if(Number.isFinite(probabilities['Other FT'])&&Number.isFinite(probabilities['7+ FT'])&&probabilities['Other FT']>probabilities['7+ FT']+.30) warnings.push('OTHER_FT_IMPLAUSIBLE_RELATION');
  return {pass:warnings.length===0,warnings};
}

export function validateHtFtPaths(paths=[]){
  const warnings=[];
  for(const p of paths){
    const [hh,ha]=String(p.ht??'').split('-').map(Number),[fh,fa]=String(p.ft??'').split('-').map(Number);
    if([hh,ha,fh,fa].some(x=>!Number.isFinite(x))) {warnings.push('INVALID_PATH_SCORE');continue;}
    if(fh<hh||fa<ha) warnings.push('FT_BELOW_HT_PATH');
  }
  return {pass:warnings.length===0,warnings};
}

export function validateJointConsistency({probabilities,paths=[]}){
  const a=validateProbabilityMonotonicity(probabilities),b=validateHtFtPaths(paths);
  return {pass:a.pass&&b.pass,warnings:[...a.warnings,...b.warnings]};
}
