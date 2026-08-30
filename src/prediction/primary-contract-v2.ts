export const PRIMARY_REQUIRED_METHODS=['methodA','methodB','final'] as const;

function boundedProbability(value:any){
  if(value===null||value===undefined)return false;
  if(typeof value==='string'&&value.trim()==='')return false;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=1;
}

function validExactScore(value:any){
  return Boolean(
    value&&
    typeof value==='object'&&
    String(value.score??'').trim()&&
    boundedProbability(value.probability)
  );
}

export function verifyPrimaryContractV2(
  threshold:any,
  exactScore:any,
  marketCodes:readonly string[],
){
  const thresholdComplete=marketCodes.every(
    market=>PRIMARY_REQUIRED_METHODS.every(
      method=>boundedProbability(threshold?.[market]?.[method])
    )
  );

  const scorelineTargets=['Top-1 HT','Top-1 FT'] as const;

  const scorelineComplete=scorelineTargets.every(
    target=>PRIMARY_REQUIRED_METHODS.every(
      method=>validExactScore(exactScore?.[target]?.[method])
    )
  );

  return{
    thresholdComplete,
    scorelineComplete,
    complete:thresholdComplete&&scorelineComplete,
    thresholdCount:marketCodes.length,
    top1Count:scorelineTargets.length,
  };
}