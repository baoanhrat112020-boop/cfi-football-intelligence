import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMultiMarketShadow } from '../src/prediction/multi-market-integration.ts';

test('research keeps 3+ HT and 7+ FT raw telemetry but never promotes it automatically',()=>{
  const body:any={
    target:{home:'Alpha',away:'Beta',date:'2026-09-06'},
    markets:{
      '3+ HT':{final:.22,methodA:.26,methodB:.18},
      '7+ FT':{final:.09,methodA:.12,methodB:.07},
      'Other HT':{final:.04},
      'Other FT':{final:.05}
    },
    scoreline:{expectedGoals:{htHome:.6,htAway:.5,ftHome:1.4,ftAway:1.2}}
  };

  attachMultiMarketShadow(body);

  assert.equal(body.extremeThresholdResearchSafety.version,'CFI_EXTREME_THRESHOLD_RESEARCH_SAFETY_V1');
  assert.equal(body.extremeThresholdResearchSafety.researchOnly,true);
  assert.equal(body.extremeThresholdResearchSafety.decisionUse,false);
  assert.equal(body.extremeThresholdResearchSafety.productionEligible,false);
  assert.equal(body.extremeThresholdResearchSafety.events['3+ HT'].rawFinalProbability,.22);
  assert.equal(body.extremeThresholdResearchSafety.events['7+ FT'].rawFinalProbability,.09);
  assert.equal(body.extremeThresholdResearchSafety.events['3+ HT'].futureSixChallengerProbability,.18);
  assert.equal(body.extremeThresholdResearchSafety.events['7+ FT'].futureSixChallengerProbability,.07);
  assert.equal(body.extremeThresholdResearchSafety.events['3+ HT'].bettingProbability,null);
  assert.equal(body.extremeThresholdResearchSafety.events['7+ FT'].bettingProbability,null);
  assert.equal(body.threePlusHtSafety.decisionUse,false);
  assert.equal(body.sevenPlusFtSafety.decisionUse,false);
});
