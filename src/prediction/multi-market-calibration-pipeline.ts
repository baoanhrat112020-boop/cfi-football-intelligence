import type { MultiMarketReplayPoint } from './multi-market-backtest.ts';
import { applyBinaryCalibrator, applyMulticlassCalibrator, binaryMetrics, multiclassMetrics, selectAndFreezeBinaryCalibration, selectAndFreezeMulticlassCalibration, type BinaryPoint, type MultiClassPoint } from './multi-market-calibration.ts';

const year=(d:string)=>Number(d.slice(0,4));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

function binaryBaseline(points:BinaryPoint[],fitThrough=2025){
  const fit=points.filter(r=>year(r.date)<=fitThrough),rate=mean(fit.map(r=>r.y))??0.5;
  return Math.min(1-1e-9,Math.max(1e-9,rate));
}
function multiclassBaseline(points:MultiClassPoint[],fitThrough=2025){
  const fit=points.filter(r=>year(r.date)<=fitThrough),n=fit.length||1;
  return {home:fit.filter(r=>r.y==='home').length/n,draw:fit.filter(r=>r.y==='draw').length/n,away:fit.filter(r=>r.y==='away').length/n};
}
function binaryReport(points:BinaryPoint[],holdoutYear=2026){
  const fitted=selectAndFreezeBinaryCalibration(points,holdoutYear-1),holdout=points.filter(r=>year(r.date)===holdoutYear),base=binaryBaseline(points,holdoutYear-1);
  const raw=binaryMetrics(holdout.map(r=>({p:r.p,y:r.y}))),calibrated=binaryMetrics(holdout.map(r=>({p:applyBinaryCalibrator(fitted.frozen,r.p),y:r.y}))),baseline=binaryMetrics(holdout.map(r=>({p:base,y:r.y})));
  return{method:fitted.method,selection:fitted.selection,candidates:fitted.candidates,raw,calibrated,baseline,delta:{brierVsRaw:calibrated.brier===null||raw.brier===null?null:calibrated.brier-raw.brier,brierVsBaseline:calibrated.brier===null||baseline.brier===null?null:calibrated.brier-baseline.brier,logLossVsRaw:calibrated.logLoss===null||raw.logLoss===null?null:calibrated.logLoss-raw.logLoss,logLossVsBaseline:calibrated.logLoss===null||baseline.logLoss===null?null:calibrated.logLoss-baseline.logLoss},frozen:fitted.frozen};
}
function multiclassReport(points:MultiClassPoint[],holdoutYear=2026){
  const fitted=selectAndFreezeMulticlassCalibration(points,holdoutYear-1),holdout=points.filter(r=>year(r.date)===holdoutYear),base=multiclassBaseline(points,holdoutYear-1);
  const raw=multiclassMetrics(holdout),calibrated=multiclassMetrics(holdout.map(r=>({p:applyMulticlassCalibrator(fitted,r.p),y:r.y}))),baseline=multiclassMetrics(holdout.map(r=>({p:base,y:r.y})));
  return{method:fitted.method,selection:fitted.selection,raw,calibrated,baseline,delta:{brierVsRaw:calibrated.brier===null||raw.brier===null?null:calibrated.brier-raw.brier,brierVsBaseline:calibrated.brier===null||baseline.brier===null?null:calibrated.brier-baseline.brier,logLossVsRaw:calibrated.logLoss===null||raw.logLoss===null?null:calibrated.logLoss-raw.logLoss,logLossVsBaseline:calibrated.logLoss===null||baseline.logLoss===null?null:calibrated.logLoss-baseline.logLoss},frozen:fitted};
}

function oneXTwo(points:MultiMarketReplayPoint[],part:'ht'|'ft'):MultiClassPoint[]{return points.flatMap(r=>{const x=r.oneXTwo[part];return x?[{date:r.targetDate,p:x.p,y:x.y}]:[];});}
function ou(points:MultiMarketReplayPoint[],part:'ht'|'ft',line:string):BinaryPoint[]{return points.flatMap(r=>{const x=r.overUnder[part][line];return x?[{date:r.targetDate,p:x.p,y:x.y}]:[];});}
function ah(points:MultiMarketReplayPoint[],part:'ht'|'ft',line:string,side:'home'|'away'):BinaryPoint[]{return points.flatMap(r=>{const x=r.asianHandicap[part][line]?.[side];return x?[{date:r.targetDate,p:x.p,y:x.y}]:[];});}

export function runTemporalMultiMarketCalibration(points:MultiMarketReplayPoint[],holdoutYear=2026){
  if(points.some(r=>r.maxEvidenceDate>=r.targetDate))throw new Error('STRICT_PRIOR_VIOLATION');
  const years=[...new Set(points.map(r=>year(r.targetDate)))].sort();
  const result:any={version:'CFI_MULTI_MARKET_TEMPORAL_CALIBRATION_V1',status:'RESEARCH_ONLY',decisionUse:false,strictPrior:true,holdoutYear,fitCutoffYear:holdoutYear-1,methodSelectionYear:holdoutYear-1,methodTrainThroughYear:holdoutYear-2,years,oneXTwo:{},overUnder:{ht:{},ft:{}},asianHandicap:{ht:{},ft:{}}};
  for(const part of ['ht','ft'] as const)result.oneXTwo[part]=multiclassReport(oneXTwo(points,part),holdoutYear);
  for(const part of ['ht','ft'] as const){
    const ouLines=[...new Set(points.flatMap(r=>Object.keys(r.overUnder[part])))].sort((a,b)=>Number(a)-Number(b));
    for(const line of ouLines)result.overUnder[part][line]=binaryReport(ou(points,part,line),holdoutYear);
    const ahLines=[...new Set(points.flatMap(r=>Object.keys(r.asianHandicap[part])))].sort((a,b)=>Number(a)-Number(b));
    for(const line of ahLines)result.asianHandicap[part][line]={home:binaryReport(ah(points,part,line,'home'),holdoutYear),away:binaryReport(ah(points,part,line,'away'),holdoutYear)};
  }
  return result;
}
