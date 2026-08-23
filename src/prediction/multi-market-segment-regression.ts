export type SegmentMetric={segment:string;n:number;candidateBrier:number|null;baselineBrier:number|null;rawBrier?:number|null};
export type SegmentRegressionOptions={minSegmentN?:number;maxBrierRegression?:number;requireRawNonRegression?:boolean};
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x);
const validBrier=(x:unknown)=>finite(x)&&Number(x)>=0&&Number(x)<=1;
export function evaluateSegmentRegression(rows:SegmentMetric[],options:SegmentRegressionOptions={}){
  const minSegmentN=Math.max(1,Math.floor(options.minSegmentN??30));
  const maxBrierRegression=Number(options.maxBrierRegression??0.02);
  const requireRawNonRegression=options.requireRawNonRegression!==false;
  const qualifiedFailures:string[]=[];
  const reasonCodes:string[]=[];
  const segments=rows.map(r=>{
    const n=Number(r.n??0),cb=r.candidateBrier,bb=r.baselineBrier,rb=r.rawBrier;
    const reasons:string[]=[];
    if(!r.segment?.trim())reasons.push('SEGMENT_ID_REQUIRED');
    if(!Number.isFinite(n)||n<minSegmentN)reasons.push('SEGMENT_SAMPLE_TOO_SMALL');
    if(!validBrier(cb)||!validBrier(bb))reasons.push('SEGMENT_BRIER_REQUIRED');
    if(rb!==undefined&&rb!==null&&!validBrier(rb))reasons.push('SEGMENT_RAW_BRIER_INVALID');
    const deltaBaseline=validBrier(cb)&&validBrier(bb)?Number(cb)-Number(bb):null;
    const deltaRaw=validBrier(cb)&&validBrier(rb)?Number(cb)-Number(rb):null;
    if(deltaBaseline!==null&&deltaBaseline>maxBrierRegression+1e-12)reasons.push('SEGMENT_BASELINE_REGRESSION');
    if(requireRawNonRegression&&validBrier(rb)&&deltaRaw!==null&&deltaRaw>1e-12)reasons.push('SEGMENT_RAW_REGRESSION');
    if(reasons.length){
      reasonCodes.push(...reasons);
      qualifiedFailures.push(...reasons.map(x=>`${r.segment||'UNKNOWN'}:${x}`));
    }
    return{segment:r.segment,n:Number.isFinite(n)?n:null,candidateBrier:validBrier(cb)?Number(cb):null,baselineBrier:validBrier(bb)?Number(bb):null,rawBrier:validBrier(rb)?Number(rb):null,deltaBaseline,deltaRaw,status:reasons.length?'FAIL':'PASS',reasons};
  });
  const eligible=segments.filter(s=>typeof s.n==='number'&&s.n>=minSegmentN);
  const worstBaselineDelta=eligible.map(s=>s.deltaBaseline).filter((x):x is number=>x!==null).sort((a,b)=>b-a)[0]??null;
  const hardFailures=[...new Set([...reasonCodes,...qualifiedFailures])];
  return{version:'CFI_MULTI_MARKET_SEGMENT_REGRESSION_V1',status:hardFailures.length?'BLOCKED':'PASS',decisionUse:false,minSegmentN,maxBrierRegression,requireRawNonRegression,worstBaselineDelta,segments,hardFailures};
}
