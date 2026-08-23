export type SegmentMetric={segment:string;n:number;candidateBrier:number|null;baselineBrier:number|null;rawBrier?:number|null};
export type SegmentRegressionOptions={minSegmentN?:number;maxBrierRegression?:number;requireRawNonRegression?:boolean};
const finite=(x:unknown)=>Number.isFinite(Number(x));
export function evaluateSegmentRegression(rows:SegmentMetric[],options:SegmentRegressionOptions={}){
  const minSegmentN=Math.max(1,Math.floor(options.minSegmentN??30));
  const maxBrierRegression=Number(options.maxBrierRegression??0.02);
  const requireRawNonRegression=options.requireRawNonRegression!==false;
  const failures:string[]=[];
  const segments=rows.map(r=>{
    const n=Number(r.n??0),cb=r.candidateBrier,bb=r.baselineBrier,rb=r.rawBrier;
    const reasons:string[]=[];
    if(!r.segment?.trim())reasons.push('SEGMENT_ID_REQUIRED');
    if(n<minSegmentN)reasons.push('SEGMENT_SAMPLE_TOO_SMALL');
    if(!finite(cb)||!finite(bb))reasons.push('SEGMENT_BRIER_REQUIRED');
    const deltaBaseline=finite(cb)&&finite(bb)?Number(cb)-Number(bb):null;
    const deltaRaw=finite(cb)&&finite(rb)?Number(cb)-Number(rb):null;
    if(deltaBaseline!==null&&deltaBaseline>maxBrierRegression+1e-12)reasons.push('SEGMENT_BASELINE_REGRESSION');
    if(requireRawNonRegression&&finite(rb)&&deltaRaw!==null&&deltaRaw>1e-12)reasons.push('SEGMENT_RAW_REGRESSION');
    if(reasons.length)failures.push(...reasons.map(x=>`${r.segment||'UNKNOWN'}:${x}`));
    return{segment:r.segment,n,candidateBrier:finite(cb)?Number(cb):null,baselineBrier:finite(bb)?Number(bb):null,rawBrier:finite(rb)?Number(rb):null,deltaBaseline,deltaRaw,status:reasons.length?'FAIL':'PASS',reasons};
  });
  const eligible=segments.filter(s=>s.n>=minSegmentN);
  const worstBaselineDelta=eligible.map(s=>s.deltaBaseline).filter((x):x is number=>x!==null).sort((a,b)=>b-a)[0]??null;
  return{version:'CFI_MULTI_MARKET_SEGMENT_REGRESSION_V1',status:failures.length?'BLOCKED':'PASS',decisionUse:false,minSegmentN,maxBrierRegression,requireRawNonRegression,worstBaselineDelta,segments,hardFailures:[...new Set(failures)]};
}
