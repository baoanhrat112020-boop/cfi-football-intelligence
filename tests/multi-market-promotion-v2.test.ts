import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMultiMarketPromotionV2 } from '../src/prediction/multi-market-promotion-v2.ts';

const base={market:'FT_1X2',strictPrior:true,temporalLeakage:false,coherenceStatus:'PASS' as const,deterministic:true,swapPass:true,collapsePass:true,segmentWorstBrierDelta:0.005};
const metric=(c=.16,b=.24,r=.22,n=300)=>({raw:{n,brier:r},calibrated:{n,brier:c},baseline:{n,brier:b}});

test('eligible research result can only become shadow eligible',()=>{
 const r=evaluateMultiMarketPromotionV2({...base,metric:metric()});
 assert.ok(r.score>=80);
 assert.equal(r.shadowEligible,true);
 assert.equal(r.productionEligible,false);
 assert.equal(r.decisionUse,false);
 assert.equal(r.baselineLock,'R0_IMMUTABLE');
});

test('hard gates override a high metric score',()=>{
 const r=evaluateMultiMarketPromotionV2({...base,metric:metric(.10,.30,.20),temporalLeakage:true});
 assert.equal(r.shadowEligible,false);
 assert.ok(r.hardFailures.includes('TEMPORAL_LEAKAGE'));
});

test('regression versus baseline/raw and weak segment fail closed',()=>{
 const r=evaluateMultiMarketPromotionV2({...base,metric:metric(.26,.24,.25),segmentWorstBrierDelta:.03});
 assert.equal(r.shadowEligible,false);
 assert.ok(r.hardFailures.includes('BRIER_WORSE_THAN_BASELINE'));
 assert.ok(r.hardFailures.includes('CALIBRATION_REGRESSION'));
 assert.ok(r.hardFailures.includes('SEGMENT_REGRESSION'));
});

test('sample floor is 30',()=>{
 const r=evaluateMultiMarketPromotionV2({...base,metric:metric(.18,.24,.22,29)});
 assert.equal(r.shadowEligible,false);
 assert.ok(r.hardFailures.includes('INSUFFICIENT_SAMPLE'));
});
