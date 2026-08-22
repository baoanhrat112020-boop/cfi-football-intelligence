import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FUSION_POLICY } from '../research/fusion/contracts.mjs';
import { buildFusionPrediction } from '../research/fusion/fusion-engine.mjs';

const base={'3+ HT':.12,'7+ FT':.02,'Other HT':.01,'Other FT':.03};
const provenance=name=>({maxEvidenceTimestamp:'2026-08-21T23:59:59.000Z',futureEvidenceCount:0,sameDateEvidenceCount:0,identityHash:'fixture:A:B:2026-08-22',provenanceHash:`test:${name}`});
const expert=(name,p=base)=>({expert:name,probabilities:{...p},confidence:{coverage:.9,localSample:100},top3HT:['1-0','1-1','0-1'],top3FT:['2-1','1-1','2-0'],provenance:provenance(name)});

test('default policy prunes historically harmful F4/F5 behavior',()=>{
  assert.equal(DEFAULT_FUSION_POLICY.useSelectiveGate,false);
  assert.equal(DEFAULT_FUSION_POLICY.useTemporalCalibration,false);
  assert.equal(DEFAULT_FUSION_POLICY.useTargetRouter,true);
  assert.equal(DEFAULT_FUSION_POLICY.preserveFutureSixTop3,true);
});

test('in-distribution default uses routed regime probability without selective rollback',async()=>{
  const experts={
    FUTURE_SIX:expert('FUTURE_SIX',base),
    HISTORICAL:expert('HISTORICAL',base),
    MATCH_DNA:expert('MATCH_DNA',{...base,'7+ FT':.05}),
    REGIME:expert('REGIME',{...base,'7+ FT':.06}),
  };
  const r=await buildFusionPrediction({
    targetDate:'2026-08-22',maxEvidenceDate:'2026-08-21',experts,
    context:{homePriorMatches:40,awayPriorMatches:40,dnaNeighbors:100,segment:'M|SENIOR|ELITE_PRO',imageCompleteness:1,regimeSupport:1},
    htGrid:[],ftGrid:[],modulePolicy:{enableTailConditional:false}
  });
  assert.equal(r.probabilities['7+ FT'],.06);
  assert.equal(r.routerAudit['7+ FT'].routed.expert,'REGIME');
  assert.equal(r.routerAudit['7+ FT'].gate.reason,'SELECTIVE_GATE_DISABLED');
  assert.deepEqual(r.top3HT,['1-0','1-1','0-1']);
});
