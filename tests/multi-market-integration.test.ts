import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMultiMarketShadow } from '../src/prediction/multi-market-integration.ts';

function championBody(){
  return {
    status:'SUCCESS',
    markets:{
      '3+ HT':{final:.21,scorelineMass:.21},
      '7+ FT':{final:.08,scorelineMass:.08},
      'Other HT':{final:.03,scorelineMass:.03},
      'Other FT':{final:.04,scorelineMass:.04},
    },
    scoreline:{
      ht:{final:[{score:'1-0',probability:.24},{score:'0-0',probability:.21},{score:'1-1',probability:.16}]},
      ft:{final:[{score:'2-1',probability:.14},{score:'1-1',probability:.12},{score:'2-0',probability:.1}]},
      expectedGoals:{htHome:.8,htAway:.55,ftHome:1.7,ftAway:1.1},
    },
    sixTargetMatrix:{contract:'CFI_2_METHODS_6_TARGETS',threshold:{},scoreline:{}},
    ranking:[{target:'3+ HT',probability:.21}],
    verdict:'NO_STRONG_SIGNAL',
  };
}

test('additive shadow integration preserves frozen Champion fields',()=>{
  const body=championBody();
  const frozen={
    markets:structuredClone(body.markets),
    scoreline:structuredClone(body.scoreline),
    sixTargetMatrix:structuredClone(body.sixTargetMatrix),
    ranking:structuredClone(body.ranking),
    verdict:body.verdict,
  };
  attachMultiMarketShadow(body);
  assert.deepEqual(body.markets,frozen.markets);
  assert.deepEqual(body.scoreline,frozen.scoreline);
  assert.deepEqual(body.sixTargetMatrix,frozen.sixTargetMatrix);
  assert.deepEqual(body.ranking,frozen.ranking);
  assert.equal(body.verdict,frozen.verdict);
  assert.equal(body.multiMarket.version,'CFI_MULTI_MARKET_V1');
  assert.equal(body.multiMarket.status,'SHADOW_RESEARCH');
  assert.equal(body.multiMarket.decisionUse,false);
  assert.equal(body.multiMarket.consistencyGuard.status,'PASS');
  assert.equal(body.multiMarketIntegration.status,'SHADOW_READY');
  assert.equal(body.multiMarketIntegration.championMutation,false);
});

test('missing expected-goal telemetry leaves Champion usable and marks shadow unavailable',()=>{
  const body=championBody();
  delete (body.scoreline as any).expectedGoals.ftAway;
  const frozen=structuredClone(body);
  attachMultiMarketShadow(body);
  assert.equal(body.multiMarket,undefined);
  assert.equal(body.multiMarketIntegration.status,'UNAVAILABLE');
  assert.equal(body.multiMarketIntegration.decisionUse,false);
  assert.equal(body.multiMarketIntegration.reason,'EXPECTED_GOALS_TELEMETRY_REQUIRED');
  assert.deepEqual(body.markets,frozen.markets);
  assert.deepEqual(body.scoreline,frozen.scoreline);
});
