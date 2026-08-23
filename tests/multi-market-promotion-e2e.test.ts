import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMultiMarketPromotionE2E } from '../src/prediction/multi-market-promotion-e2e.ts';

const metric=(c=.17,b=.24,r=.22,n=300)=>({raw:{n,brier:r},calibrated:{n,brier:c},baseline:{n,brier:b}});
const base={market:'FT_1X2',strictPrior:true,temporalLeakage:false,coherenceStatus:'PASS' as const,deterministic:true,swapPass:true,collapsePass:true,metric:metric()};

test('promotion e2e requires both aggregate and segment gates',()=>{
 const r=evaluateMultiMarketPromotionE2E(base,[
  {segment:'league:A',n:80,candidateBrier:.18,baselineBrier:.22,rawBrier:.20},
  {segment:'league:B',n:60,candidateBrier:.19,baselineBrier:.21,rawBrier:.20},
 ]);
 assert.equal(r.segmentGate.status,'PASS');
 assert.equal(r.shadowEligible,true);
 assert.equal(r.productionEligible,false);
 assert.equal(r.decisionUse,false);
});

test('small unsupported cohort blocks otherwise strong aggregate candidate',()=>{
 const r=evaluateMultiMarketPromotionE2E(base,[
  {segment:'league:A',n:80,candidateBrier:.18,baselineBrier:.22,rawBrier:.20},
  {segment:'league:thin',n:9,candidateBrier:.10,baselineBrier:.30,rawBrier:.20},
 ]);
 assert.equal(r.promotionGate.shadowEligible,true);
 assert.equal(r.segmentGate.status,'BLOCKED');
 assert.equal(r.shadowEligible,false);
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_SAMPLE_TOO_SMALL')));
});

test('weak cohort blocks promotion even when aggregate score passes 80',()=>{
 const r=evaluateMultiMarketPromotionE2E(base,[
  {segment:'league:A',n:100,candidateBrier:.16,baselineBrier:.23,rawBrier:.19},
  {segment:'league:B',n:50,candidateBrier:.27,baselineBrier:.22,rawBrier:.24},
 ]);
 assert.ok(r.score>=80);
 assert.equal(r.shadowEligible,false);
 assert.ok(r.hardFailures.some(x=>x.includes('SEGMENT_BASELINE_REGRESSION')));
});
