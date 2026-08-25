import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSegmentRegression } from '../src/prediction/multi-market-segment-regression.ts';

test('all sufficiently supported non-regressing segments pass research gate',()=>{
 const r=evaluateSegmentRegression([
  {segment:'league:A',n:80,candidateBrier:.19,baselineBrier:.22,rawBrier:.20},
  {segment:'league:B',n:55,candidateBrier:.21,baselineBrier:.22,rawBrier:.21},
 ]);
 assert.equal(r.status,'PASS');
 assert.equal(r.decisionUse,false);
 assert.equal(r.hardFailures.length,0);
});

test('aggregate-looking candidate is blocked by one weak segment',()=>{
 const r=evaluateSegmentRegression([
  {segment:'league:A',n:120,candidateBrier:.17,baselineBrier:.23,rawBrier:.19},
  {segment:'league:B',n:45,candidateBrier:.26,baselineBrier:.22,rawBrier:.24},
 ]);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_BASELINE_REGRESSION')));
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_RAW_REGRESSION')));
});

test('small or malformed segments fail closed instead of being silently ignored',()=>{
 const r=evaluateSegmentRegression([{segment:'league:C',n:12,candidateBrier:null,baselineBrier:.2}]);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_SAMPLE_TOO_SMALL')));
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_BRIER_REQUIRED')));
});
