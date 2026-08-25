import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMultiMarketPromotion} from '../research/multimarket-promotion-gate-v2.mjs';
const components={accuracyBrier:90,calibrationEce:90,rankingDiscrimination:90,crossMarketCoherence:100,temporalOotRobustness:90,segmentRegimeRobustness:85,determinismSwapDiversity:100,decisionUtilityMarketComparison:80};
const gates={strictPrior:true,temporalLeakage:true,validProbability:true,calibrationFloor:true,forecastCollapse:true,determinism:true,swap:true,crossMarketCoherence:true,noReconstruction:true,noHoldoutTuning:true};
test('score >=80 with all hard gates can only become shadow eligible',()=>{const r=evaluateMultiMarketPromotion({components,gates,sampleSupport:300});assert.ok(r.score>=80);assert.equal(r.shadowEligible,true);assert.equal(r.productionEligible,false);});
test('a strong score cannot bypass temporal leakage gate',()=>{const r=evaluateMultiMarketPromotion({components,gates:{...gates,temporalLeakage:false},sampleSupport:300});assert.ok(r.score>=80);assert.equal(r.shadowEligible,false);assert.equal(r.status,'FAIL_HARD_GATE');assert.ok(r.hardFailures.includes('GATE_TEMPORALLEAKAGE_FAIL'));});
test('sample floor is 30',()=>{const r=evaluateMultiMarketPromotion({components,gates,sampleSupport:29});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('INSUFFICIENT_SAMPLE_SUPPORT'));});
test('external pretrained challenger requires K017 matched-clean or prospective evidence',()=>{const r=evaluateMultiMarketPromotion({components,gates,sampleSupport:300,externalPretrained:true});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('K017_MATCHED_CLEAN_OR_PROSPECTIVE_REQUIRED'));});
