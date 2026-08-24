import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMultiMarketShadow, isExpectedK048ShadowFailure } from '../src/prediction/multi-market-integration.ts';
import { buildMultiMarketV1 } from '../src/prediction/multi-market-v1.ts';

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

function alignedChampionBody(){
  const body=championBody();
  const e=body.scoreline.expectedGoals;
  const mm=buildMultiMarketV1(e);
  body.markets['3+ HT'].final=mm.overUnder.ht['2.5'].over.fullWin;
  body.markets['3+ HT'].scorelineMass=body.markets['3+ HT'].final;
  body.markets['7+ FT'].final=mm.overUnder.ft['6.5'].over.fullWin;
  body.markets['7+ FT'].scorelineMass=body.markets['7+ FT'].final;
  return body;
}

function strictPriorAlignedBody(){
  const body:any=alignedChampionBody();
  body.target={home:'Cardiff',away:'Plymouth',date:'2026-08-22'};
  body.bigDbRetrieval={temporalAudit:{targetDate:'2026-08-22',verified:true,maxEvidenceDate:'2026-07-28',futureEvidenceCount:0,sameDateEvidenceCount:0}};
  return body;
}

test('additive shadow integration preserves frozen Champion fields when equivalent events reconcile',()=>{
  const body=alignedChampionBody();
  const frozen={markets:structuredClone(body.markets),scoreline:structuredClone(body.scoreline),sixTargetMatrix:structuredClone(body.sixTargetMatrix),ranking:structuredClone(body.ranking),verdict:body.verdict};
  attachMultiMarketShadow(body);
  assert.deepEqual(body.markets,frozen.markets);assert.deepEqual(body.scoreline,frozen.scoreline);assert.deepEqual(body.sixTargetMatrix,frozen.sixTargetMatrix);assert.deepEqual(body.ranking,frozen.ranking);assert.equal(body.verdict,frozen.verdict);
  assert.equal(body.multiMarket.version,'CFI_MULTI_MARKET_V1');assert.equal(body.multiMarket.status,'SHADOW_RESEARCH');assert.equal(body.multiMarket.decisionUse,false);assert.equal(body.multiMarket.consistencyGuard.status,'PASS');assert.equal(body.multiMarketIntegration.status,'SHADOW_READY');assert.equal(body.multiMarketIntegration.crossCoreConsistency.status,'PASS');assert.equal(body.multiMarketIntegration.championMutation,false);assert.equal(body.k048TrajectoryShadow.status,'UNAVAILABLE');
});

test('K048 promoted research candidate runs as active shadow without mutating Champion',()=>{
  const body=strictPriorAlignedBody();
  const frozen={markets:structuredClone(body.markets),scoreline:structuredClone(body.scoreline),sixTargetMatrix:structuredClone(body.sixTargetMatrix),ranking:structuredClone(body.ranking),verdict:body.verdict};
  attachMultiMarketShadow(body);
  assert.equal(body.k048TrajectoryShadow.version,'CFI_K048_TRAJECTORY_JOINT_V1');assert.equal(body.k048TrajectoryShadow.status,'SHADOW_ELIGIBLE_ACTIVE');assert.equal(body.k048TrajectoryShadow.researchOnly,true);assert.equal(body.k048TrajectoryShadow.decisionUse,false);assert.equal(body.k048TrajectoryShadow.productionEligible,false);assert.equal(body.k048TrajectoryShadow.baselineLock,'R0_IMMUTABLE');assert.equal(body.k048TrajectoryShadow.promotionEvidence.score,100);assert.equal(body.k048TrajectoryShadow.marginalAudit.status,'PASS');assert.ok(body.k048TrajectoryShadow.trajectoryCount>0);assert.equal(body.k048TrajectoryShadow.topTrajectories.length,12);
  const transition=body.k048TrajectoryShadow.htToFtOutcomeTransition;const total=Object.values(transition).flatMap((x:any)=>Object.values(x)).reduce((a:any,b:any)=>Number(a)+Number(b),0);assert.ok(Math.abs(Number(total)-1)<1e-9);assert.equal(body.multiMarketIntegration.k048Status,'SHADOW_ELIGIBLE_ACTIVE');
  assert.deepEqual(body.markets,frozen.markets);assert.deepEqual(body.scoreline,frozen.scoreline);assert.deepEqual(body.sixTargetMatrix,frozen.sixTargetMatrix);assert.deepEqual(body.ranking,frozen.ranking);assert.equal(body.verdict,frozen.verdict);
});

test('K048 shadow filters zero-mass score support and remains fail-safe for degenerate lambdas',()=>{
  const body:any=strictPriorAlignedBody();
  body.scoreline.expectedGoals={htHome:0,htAway:0,ftHome:1.4,ftAway:0};
  const mm=buildMultiMarketV1(body.scoreline.expectedGoals);
  body.markets['3+ HT'].final=mm.overUnder.ht['2.5'].over.fullWin;body.markets['3+ HT'].scorelineMass=body.markets['3+ HT'].final;
  body.markets['7+ FT'].final=mm.overUnder.ft['6.5'].over.fullWin;body.markets['7+ FT'].scorelineMass=body.markets['7+ FT'].final;
  assert.doesNotThrow(()=>attachMultiMarketShadow(body));
  assert.equal(body.k048TrajectoryShadow.status,'SHADOW_ELIGIBLE_ACTIVE');assert.equal(body.k048TrajectoryShadow.marginalAudit.status,'PASS');assert.ok(body.k048TrajectoryShadow.trajectoryCount>0);assert.equal(body.k048TrajectoryShadow.decisionUse,false);assert.equal(body.k048TrajectoryShadow.championMutation,false);
});

test('known K048 numerical/feasibility failures are optional-shadow failures only',()=>{
  for(const code of ['K048_INFEASIBLE_HT_SUPPORT','K048_INFEASIBLE_FT_SUPPORT','K048_IPF_ROW_ZERO','K048_IPF_COL_ZERO','K048_MARGINAL_PRESERVATION_FAIL']){
    assert.equal(isExpectedK048ShadowFailure(new Error(code)),true,code);
  }
  assert.equal(isExpectedK048ShadowFailure(new Error('K048_INVALID_SCORE')),false);
  assert.equal(isExpectedK048ShadowFailure(new Error('STRICT_PRIOR_FAILURE')),false);
});

test('equivalent-event divergence blocks shadow promotion without mutating Champion',()=>{
  const body=championBody();const frozenMarkets=structuredClone(body.markets);attachMultiMarketShadow(body);assert.equal(body.multiMarket.consistencyGuard.status,'PASS');assert.equal(body.multiMarketIntegration.status,'SHADOW_BLOCKED');assert.equal(body.multiMarketIntegration.reason,'CROSS_CORE_EQUIVALENCE_FAIL');assert.equal(body.multiMarketIntegration.crossCoreConsistency.status,'FAIL');assert.ok(body.multiMarketIntegration.crossCoreConsistency.checks.some((x:any)=>x.event==='7+ FT ≡ FT O6.5'&&x.status==='FAIL'));assert.deepEqual(body.markets,frozenMarkets);
});

test('missing expected-goal telemetry leaves Champion usable and marks shadow unavailable',()=>{
  const body=championBody();delete (body.scoreline as any).expectedGoals.ftAway;const frozen=structuredClone(body);attachMultiMarketShadow(body);assert.equal(body.multiMarket,undefined);assert.equal(body.multiMarketIntegration.status,'UNAVAILABLE');assert.equal(body.multiMarketIntegration.decisionUse,false);assert.equal(body.multiMarketIntegration.reason,'EXPECTED_GOALS_TELEMETRY_REQUIRED');assert.equal(body.k048TrajectoryShadow.status,'UNAVAILABLE');assert.deepEqual(body.markets,frozen.markets);assert.deepEqual(body.scoreline,frozen.scoreline);
});
