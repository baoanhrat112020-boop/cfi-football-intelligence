const clamp01=x=>Math.max(0,Math.min(1,Number(x)));

export function conformalQuantile(values,alpha=.10){
  const xs=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length) throw new Error('CONFORMAL_RESIDUALS_REQUIRED');
  const k=Math.min(xs.length-1,Math.max(0,Math.ceil((xs.length+1)*(1-alpha))-1));
  return xs[k];
}

export function selectStrictPriorResiduals({rows,targetDate,regimeKey,market,minLocal=100}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate??''))) throw new Error('TARGET_DATE_REQUIRED');
  const prior=rows.filter(r=>r.market===market && String(r.targetDate)<String(targetDate) && Number.isFinite(Number(r.residual)));
  const local=prior.filter(r=>r.regimeKey===regimeKey);
  const selected=local.length>=minLocal?local:prior;
  if(!selected.length) throw new Error('CONFORMAL_PRIOR_RESIDUALS_REQUIRED');
  return {scope:local.length>=minLocal?'LOCAL':'GLOBAL_FALLBACK',rows:selected};
}

export function buildRccpInterval({probability,residuals,alpha=.10}){
  const p=Number(probability);
  if(!Number.isFinite(p)||p<0||p>1) throw new Error('INVALID_PROBABILITY');
  const q=conformalQuantile(residuals.map(r=>Number(r.residual)),alpha);
  return {lower:clamp01(p-q),upper:clamp01(p+q),radius:q,nominalCoverage:1-alpha};
}
