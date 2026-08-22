export type BinaryPoint={date:string;p:number;y:0|1};
export type MultiClassPoint={date:string;p:{home:number;draw:number;away:number};y:'home'|'draw'|'away'};
export type CalibrationMethod='IDENTITY'|'PLATT'|'ISOTONIC';

type PlattSpec={method:'PLATT';a:number;b:number};
type IsotonicSpec={method:'ISOTONIC';blocks:Array<{upper:number;value:number}>};
export type BinaryCalibrator={method:'IDENTITY'}|PlattSpec|IsotonicSpec;
export type MulticlassCalibrator={method:CalibrationMethod;classes:{home:BinaryCalibrator;draw:BinaryCalibrator;away:BinaryCalibrator};selection:{trainThrough:string;validationYear:number;refitThrough:string;validationMetrics:ReturnType<typeof multiclassMetrics>}};

const EPS=1e-9;
const clamp=(x:number,min=EPS,max=1-EPS)=>Math.max(min,Math.min(max,x));
const logit=(p:number)=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

export function binaryMetrics(points:Array<{p:number;y:0|1}>,bins=10){
  if(!points.length)return{n:0,brier:null,logLoss:null,ece:null,prevalence:null,meanP:null,reliability:[] as any[]};
  const brier=mean(points.map(r=>(r.p-r.y)**2))!;
  const logLoss=mean(points.map(r=>-(r.y*Math.log(clamp(r.p))+(1-r.y)*Math.log(1-clamp(r.p)))))!;
  const reliability:any[]=[];let ece=0;
  for(let i=0;i<bins;i++){
    const lo=i/bins,hi=(i+1)/bins,rows=points.filter(r=>r.p>=lo&&(i===bins-1?r.p<=hi:r.p<hi));
    if(!rows.length)continue;
    const meanP=mean(rows.map(r=>r.p))!,actual=mean(rows.map(r=>r.y))!,weight=rows.length/points.length;
    ece+=weight*Math.abs(meanP-actual);reliability.push({lo,hi,n:rows.length,meanP,actual});
  }
  return{n:points.length,brier,logLoss,ece,prevalence:mean(points.map(r=>r.y)),meanP:mean(points.map(r=>r.p)),reliability};
}

function fitPlatt(points:BinaryPoint[]):PlattSpec{
  if(points.length<20||new Set(points.map(r=>r.y)).size<2)return{method:'PLATT',a:1,b:0};
  let a=1,b=0;
  for(let iter=0;iter<60;iter++){
    let gA=0,gB=0,hAA=1e-4,hAB=0,hBB=1e-4;
    for(const r of points){const x=logit(r.p),q=sigmoid(a*x+b),d=q-r.y,w=Math.max(1e-6,q*(1-q));gA+=d*x;gB+=d;hAA+=w*x*x;hAB+=w*x;hBB+=w;}
    const det=hAA*hBB-hAB*hAB;if(Math.abs(det)<1e-12)break;
    const dA=(gA*hBB-gB*hAB)/det,dB=(hAA*gB-hAB*gA)/det;a-=dA;b-=dB;
    if(Math.abs(dA)+Math.abs(dB)<1e-8)break;
  }
  return{method:'PLATT',a,b};
}

function fitIsotonic(points:BinaryPoint[]):IsotonicSpec{
  const rows=[...points].sort((a,b)=>a.p-b.p||a.date.localeCompare(b.date));
  if(rows.length<20)return{method:'ISOTONIC',blocks:[{upper:1,value:rows.length?mean(rows.map(r=>r.y))!:0.5}]};
  type Block={lo:number;hi:number;sum:number;n:number};const blocks:Block[]=[];
  for(const r of rows){blocks.push({lo:r.p,hi:r.p,sum:r.y,n:1});while(blocks.length>=2){const a=blocks[blocks.length-2],b=blocks[blocks.length-1];if(a.sum/a.n<=b.sum/b.n+1e-15)break;blocks.splice(blocks.length-2,2,{lo:a.lo,hi:b.hi,sum:a.sum+b.sum,n:a.n+b.n});}}
  return{method:'ISOTONIC',blocks:blocks.map(b=>({upper:b.hi,value:b.sum/b.n}))};
}

export function applyBinaryCalibrator(spec:BinaryCalibrator,p:number){
  const x=clamp(p);
  if(spec.method==='IDENTITY')return x;
  if(spec.method==='PLATT')return clamp(sigmoid(spec.a*logit(x)+spec.b));
  const block=spec.blocks.find(b=>x<=b.upper)??spec.blocks.at(-1);return clamp(block?.value??x);
}
function fitBinary(method:CalibrationMethod,points:BinaryPoint[]):BinaryCalibrator{return method==='IDENTITY'?{method:'IDENTITY'}:method==='PLATT'?fitPlatt(points):fitIsotonic(points);}

export function selectAndFreezeBinaryCalibration(points:BinaryPoint[],validationYear=2025){
  const train=points.filter(r=>Number(r.date.slice(0,4))<validationYear),validation=points.filter(r=>Number(r.date.slice(0,4))===validationYear),refit=points.filter(r=>Number(r.date.slice(0,4))<=validationYear);
  const candidates:CalibrationMethod[]=['IDENTITY','PLATT','ISOTONIC'];
  const scored=candidates.map(method=>{const spec=fitBinary(method,train),rows=validation.map(r=>({p:applyBinaryCalibrator(spec,r.p),y:r.y})),metrics=binaryMetrics(rows);return{method,spec,metrics};});
  scored.sort((a,b)=>(a.metrics.logLoss??Infinity)-(b.metrics.logLoss??Infinity)||(a.metrics.brier??Infinity)-(b.metrics.brier??Infinity));
  const chosen=validation.length>=100&&new Set(validation.map(r=>r.y)).size===2?scored[0]:scored.find(x=>x.method==='IDENTITY')!;
  const frozen=fitBinary(chosen.method,refit);
  return{method:chosen.method,frozen,selection:{trainThrough:`${validationYear-1}-12-31`,validationYear,refitThrough:`${validationYear}-12-31`,validationMetrics:chosen.metrics},candidates:scored.map(x=>({method:x.method,metrics:x.metrics}))};
}

function asBinary(points:MultiClassPoint[],cls:'home'|'draw'|'away'):BinaryPoint[]{return points.map(r=>({date:r.date,p:r.p[cls],y:r.y===cls?1:0}));}
function normalize3(p:{home:number;draw:number;away:number}){const z=p.home+p.draw+p.away||1;return{home:p.home/z,draw:p.draw/z,away:p.away/z};}
export function applyMulticlassCalibrator(spec:MulticlassCalibrator,p:{home:number;draw:number;away:number}){
  return normalize3({home:applyBinaryCalibrator(spec.classes.home,p.home),draw:applyBinaryCalibrator(spec.classes.draw,p.draw),away:applyBinaryCalibrator(spec.classes.away,p.away)});
}
export function multiclassMetrics(points:Array<{p:{home:number;draw:number;away:number};y:'home'|'draw'|'away'}>){
  if(!points.length)return{n:0,brier:null,logLoss:null};
  const brier=mean(points.map(r=>((r.p.home-(r.y==='home'?1:0))**2+(r.p.draw-(r.y==='draw'?1:0))**2+(r.p.away-(r.y==='away'?1:0))**2)/3))!;
  const logLoss=mean(points.map(r=>-Math.log(clamp(r.p[r.y]))))!;return{n:points.length,brier,logLoss};
}
export function selectAndFreezeMulticlassCalibration(points:MultiClassPoint[],validationYear=2025):MulticlassCalibrator{
  const train=points.filter(r=>Number(r.date.slice(0,4))<validationYear),validation=points.filter(r=>Number(r.date.slice(0,4))===validationYear),refit=points.filter(r=>Number(r.date.slice(0,4))<=validationYear);
  const methods:CalibrationMethod[]=['IDENTITY','PLATT','ISOTONIC'];
  const evaluated=methods.map(method=>{
    const classes={home:fitBinary(method,asBinary(train,'home')),draw:fitBinary(method,asBinary(train,'draw')),away:fitBinary(method,asBinary(train,'away'))};
    const metrics=multiclassMetrics(validation.map(r=>({p:normalize3({home:applyBinaryCalibrator(classes.home,r.p.home),draw:applyBinaryCalibrator(classes.draw,r.p.draw),away:applyBinaryCalibrator(classes.away,r.p.away)}),y:r.y})));
    return{method,metrics};
  }).sort((a,b)=>(a.metrics.logLoss??Infinity)-(b.metrics.logLoss??Infinity)||(a.metrics.brier??Infinity)-(b.metrics.brier??Infinity));
  const chosen=validation.length>=200?evaluated[0]:evaluated.find(x=>x.method==='IDENTITY')!;
  const classes={home:fitBinary(chosen.method,asBinary(refit,'home')),draw:fitBinary(chosen.method,asBinary(refit,'draw')),away:fitBinary(chosen.method,asBinary(refit,'away'))};
  return{method:chosen.method,classes,selection:{trainThrough:`${validationYear-1}-12-31`,validationYear,refitThrough:`${validationYear}-12-31`,validationMetrics:chosen.metrics}};
}

export function evaluateFrozenBinaryOnYear(points:BinaryPoint[],frozen:BinaryCalibrator,year:number){
  const rows=points.filter(r=>Number(r.date.slice(0,4))===year);return{raw:binaryMetrics(rows.map(r=>({p:r.p,y:r.y}))),calibrated:binaryMetrics(rows.map(r=>({p:applyBinaryCalibrator(frozen,r.p),y:r.y})))};
}
export function evaluateFrozenMulticlassOnYear(points:MultiClassPoint[],frozen:MulticlassCalibrator,year:number){
  const rows=points.filter(r=>Number(r.date.slice(0,4))===year);return{raw:multiclassMetrics(rows),calibrated:multiclassMetrics(rows.map(r=>({p:applyMulticlassCalibrator(frozen,r.p),y:r.y})))};
}
