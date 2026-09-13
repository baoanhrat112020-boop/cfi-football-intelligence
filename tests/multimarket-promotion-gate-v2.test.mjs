import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMultiMarketPromotion,MULTIMARKET_RESEARCH_CONTRACT_VERSION,REQUIRED_OUTPUT_GROUPS} from '../research/multimarket-promotion-gate-v2.mjs';
const components={accuracyBrier:90,calibrationEce:90,rankingDiscrimination:90,crossMarketCoherence:100,temporalOotRobustness:90,segmentRegimeRobustness:85,determinismSwapDiversity:100,decisionUtilityMarketComparison:80};
const gates={strictPrior:true,temporalLeakage:true,validProbability:true,calibrationFloor:true,forecastCollapse:true,determinism:true,swap:true,crossMarketCoherence:true,noReconstruction:true,noHoldoutTuning:true,uncertaintyAbstention:true};
const outputCoverage=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,true]));
const perGroup=Object.fromEntries(REQUIRED_OUTPUT_GROUPS.map(group=>[group,{evaluated:true,unacceptableRegression:false}]));
const baselineComparison={paired:true,baselineReproducible:true,aggregateNetImprovementOrPreservation:true,noUnacceptableRegression:true,requiredGroups:REQUIRED_OUTPUT_GROUPS,perGroup,aggregateBrierDelta:-0.001,aggregateLogLossDelta:-0.002};
const valid={components,gates,sampleSupport:300,contractVersion:MULTIMARKET_RESEARCH_CONTRACT_VERSION,outputCoverage,baselineComparison,decisionUse:false,productionMutationAllowed:false};
test('caller cannot omit mandatory groups using an empty requiredGroups list',()=>{
  const r=evaluateMultiMarketPromotion({...valid,baselineComparison:{...baselineComparison,requiredGroups:[],perGroup:{}}});
  assert.equal(r.shadowEligible,false);
  for(const group of REQUIRED_OUTPUT_GROUPS)assert.ok(r.hardFailures.includes(`BASELINE_COMPARISON_${group}_MISSING`));
});
test('narrowed requiredGroups cannot conceal a regression',()=>{
  const r=evaluateMultiMarketPromotion({...valid,baselineComparison:{...baselineComparison,requiredGroups:['CHAMPION_6'],perGroup:{...perGroup,AH_FT:{evaluated:true,unacceptableRegression:true}}}});
  assert.ok(r.hardFailures.includes('BASELINE_REGRESSION_AH_FT'));
  assert.equal(r.shadowEligible,false);
});
test('both aggregate proper-score deltas must be actual finite numbers',()=>{
  for(const [key,failure] of [['aggregateBrierDelta','INVALID_AGGREGATE_BRIER_DELTA'],['aggregateLogLossDelta','INVALID_AGGREGATE_LOGLOSS_DELTA']]){
    for(const value of [undefined,null,'',false,'-0.001',NaN,Infinity,-Infinity]){
      const r=evaluateMultiMarketPromotion({...valid,baselineComparison:{...baselineComparison,[key]:value}});
      assert.equal(r.shadowEligible,false,`${key}: ${String(value)}`);
      assert.ok(r.hardFailures.includes(failure));
    }
  }
});
test('an evaluated group needs an explicit no-regression result',()=>{
  for(const value of [undefined,null,0,'false']){
    const r=evaluateMultiMarketPromotion({...valid,baselineComparison:{...baselineComparison,perGroup:{...perGroup,OU_FT:{evaluated:true,unacceptableRegression:value}}}});
    assert.equal(r.shadowEligible,false);
    assert.ok(r.hardFailures.includes('BASELINE_REGRESSION_RESULT_OU_FT_MISSING'));
  }
});
test('zero proper-score deltas preserve eligibility and do not mutate input',()=>{
  const input=structuredClone({...valid,baselineComparison:{...baselineComparison,aggregateBrierDelta:0,aggregateLogLossDelta:0}});
  const before=structuredClone(input);
  const r=evaluateMultiMarketPromotion(input);
  assert.equal(r.shadowEligible,true);
  assert.equal(r.productionEligible,false);
  assert.equal(r.decisionUse,false);
  assert.deepEqual(input,before);
});
test('score >=80 with full contract and all hard gates can only become shadow eligible',()=>{const r=evaluateMultiMarketPromotion(valid);assert.ok(r.score>=80);assert.equal(r.shadowEligible,true);assert.equal(r.productionEligible,false);assert.equal(r.decisionUse,false);});
test('a strong score cannot bypass temporal leakage gate',()=>{const r=evaluateMultiMarketPromotion({...valid,gates:{...gates,temporalLeakage:false}});assert.ok(r.score>=80);assert.equal(r.shadowEligible,false);assert.equal(r.status,'FAIL_HARD_GATE');assert.ok(r.hardFailures.includes('GATE_TEMPORALLEAKAGE_FAIL'));});
test('sample floor is 30',()=>{const r=evaluateMultiMarketPromotion({...valid,sampleSupport:29});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('INSUFFICIENT_SAMPLE_SUPPORT'));});
test('external pretrained challenger requires K017 matched-clean or prospective evidence',()=>{const r=evaluateMultiMarketPromotion({...valid,externalPretrained:true});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('K017_MATCHED_CLEAN_OR_PROSPECTIVE_REQUIRED'));});
test('legacy partial-market research cannot become shadow eligible',()=>{const r=evaluateMultiMarketPromotion({components,gates,sampleSupport:300});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('MULTIMARKET_RESEARCH_CONTRACT_VERSION_REQUIRED'));assert.ok(r.hardFailures.some(x=>x.startsWith('OUTPUT_')));});
test('isolated improvement cannot hide one market-group regression',()=>{const broken={...baselineComparison,perGroup:{...perGroup,'1X2_FT':{evaluated:true,unacceptableRegression:true}}};const r=evaluateMultiMarketPromotion({...valid,baselineComparison:broken});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('BASELINE_REGRESSION_1X2_FT'));});
test('non-reproducible baseline blocks research promotion',()=>{const r=evaluateMultiMarketPromotion({...valid,baselineComparison:{...baselineComparison,baselineReproducible:false}});assert.equal(r.shadowEligible,false);assert.ok(r.hardFailures.includes('REPRODUCIBLE_BASELINE_REQUIRED'));});
