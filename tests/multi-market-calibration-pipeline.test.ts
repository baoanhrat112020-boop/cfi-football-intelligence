import test from 'node:test';
import assert from 'node:assert/strict';
import { runTemporalMultiMarketCalibration } from '../src/prediction/multi-market-calibration-pipeline.ts';
import type { MultiMarketReplayPoint } from '../src/prediction/multi-market-backtest.ts';

function point(year:number,i:number):MultiMarketReplayPoint{
  const y1=(i%3===0?'home':i%3===1?'draw':'away') as 'home'|'draw'|'away';
  const p1=y1==='home'?{home:.58,draw:.25,away:.17}:y1==='draw'?{home:.30,draw:.42,away:.28}:{home:.18,draw:.24,away:.58};
  const totalHigh=(i%2===0?1:0) as 0|1;
  const ahHome=(i%4<2?1:0) as 0|1;
  return {
    fixtureId:`${year}-${i}`,targetDate:`${year}-08-${String((i%28)+1).padStart(2,'0')}`,maxEvidenceDate:`${year-1}-12-31`,homePriorCount:12,awayPriorCount:13,
    oneXTwo:{ht:{p:p1,y:y1},ft:{p:p1,y:y1}},
    overUnder:{ht:{'1.5':{p:totalHigh?.62:.38,y:totalHigh}},ft:{'2.5':{p:totalHigh?.64:.36,y:totalHigh}}},
    asianHandicap:{ht:{'-0.5':{home:{p:ahHome?.61:.39,y:ahHome},away:{p:ahHome?.39:.61,y:(ahHome?0:1) as 0|1}}},ft:{'-0.5':{home:{p:ahHome?.63:.37,y:ahHome},away:{p:ahHome?.37:.63,y:(ahHome?0:1) as 0|1}}}},
  };
}

test('pipeline fits only pre-holdout history and reports raw/calibrated/baseline for 2026',()=>{
  const points=[...Array.from({length:240},(_,i)=>point(2023,i)),...Array.from({length:240},(_,i)=>point(2024,i)),...Array.from({length:240},(_,i)=>point(2025,i)),...Array.from({length:240},(_,i)=>point(2026,i))];
  const report:any=runTemporalMultiMarketCalibration(points,2026);
  assert.equal(report.version,'CFI_MULTI_MARKET_TEMPORAL_CALIBRATION_V1');
  assert.equal(report.status,'RESEARCH_ONLY');
  assert.equal(report.decisionUse,false);
  assert.equal(report.strictPrior,true);
  assert.equal(report.holdoutYear,2026);
  assert.equal(report.methodTrainThroughYear,2024);
  assert.equal(report.methodSelectionYear,2025);
  assert.equal(report.fitCutoffYear,2025);
  assert.equal(report.oneXTwo.ft.raw.n,240);
  assert.equal(report.oneXTwo.ft.calibrated.n,240);
  assert.equal(report.oneXTwo.ft.baseline.n,240);
  assert.equal(report.overUnder.ft['2.5'].raw.n,240);
  assert.equal(report.asianHandicap.ft['-0.5'].home.raw.n,240);
});

test('pipeline fails closed on temporal leakage',()=>{
  const p=point(2026,1);p.maxEvidenceDate=p.targetDate;
  assert.throws(()=>runTemporalMultiMarketCalibration([p],2026),/STRICT_PRIOR_VIOLATION/);
});
