import test from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_CONTRACT, assertStrictPriorDate } from '../research/fusion/contracts.mjs';
import { classifyImageState, normalizeImageEvidence, aggregateImageEvidence, evidenceCompleteness } from '../research/fusion/image/image-evidence.mjs';
import { assessCoverage } from '../research/fusion/coverage-guard.mjs';
import { routeTarget, selectiveGate } from '../research/fusion/target-router.mjs';
import { buildTailConditional, auditTailGrid } from '../research/fusion/tail-conditional.mjs';
import { buildFusionPrediction } from '../research/fusion/fusion-engine.mjs';

const probs={'3+ HT':.15,'7+ FT':.03,'Other HT':.01,'Other FT':.04};
const expert=(name,p=probs)=>({expert:name,probabilities:{...p},confidence:{coverage:.8,localSample:100},top3HT:['1-0','1-1','0-1'],top3FT:['2-1','1-1','2-0']});
const grid=(max,scale=.7)=>{const rows=[];let z=0;for(let h=0;h<=max;h++)for(let a=0;a<=max;a++){const p=Math.exp(-(h+a)*scale);rows.push({score:`${h}-${a}`,total:h+a,probability:p});z+=p;}return rows.map(x=>({...x,probability:x.probability/z}));};

test('Fusion contract is research-only and R0 immutable',()=>{
  assert.equal(FUSION_CONTRACT.productionMutationAllowed,false);
  assert.equal(FUSION_CONTRACT.canonicalDbMutationAllowed,false);
  assert.equal(FUSION_CONTRACT.baseline,'R0_IMMUTABLE');
  assert.equal(FUSION_CONTRACT.promotionThreshold,80);
});

test('countdown is prematch evidence, not live and not empty',()=>{
  assert.equal(classifyImageState({visibleText:'Kick off in 00:04:11'}),'PREMATCH_COUNTDOWN');
  const row=normalizeImageEvidence({visibleText:'Kick off in 00:04:11',fixture:{home:'A',away:'B'},visibleFields:['fixture','form','h2h'],extracted:{homeHistory:[1],h2h:[1]},visualDensity:.8});
  assert.equal(row.imageState,'PREMATCH_COUNTDOWN');
  assert.equal(row.prematchEvidenceAllowed,true);
  assert.equal(row.liveEvidenceAllowed,false);
  assert.equal(row.suspectedFailure,false);
});

test('countdown image does not erase prior images',()=>{
  const bundle=aggregateImageEvidence([
    {imageState:'TEAM_HISTORY',fixture:{home:'A',away:'B'},extracted:{homeHistory:[1,2]}},
    {imageState:'TEAM_HISTORY',fixture:{home:'A',away:'B'},extracted:{awayHistory:[3,4]}},
    {imageState:'H2H',fixture:{home:'A',away:'B'},extracted:{h2h:[5]}},
    {imageState:'PREMATCH_COUNTDOWN',fixture:{home:'A',away:'B'},extracted:{odds:{x:2}}},
  ]);
  assert.equal(bundle.fixture.state,'PREMATCH_COUNTDOWN');
  assert.ok(bundle.extracted.homeHistory.length);
  assert.ok(bundle.extracted.awayHistory.length);
  assert.ok(bundle.extracted.h2h.length);
  assert.equal(bundle.liveEvidenceUsed,false);
});

test('rich visible image with zero extraction fails closed',()=>{
  const row=normalizeImageEvidence({visibleFields:['a','b','c','d','e','f'],visualDensity:.9,extracted:{}});
  assert.equal(row.status,'IMAGE_EXTRACTION_SUSPECTED_FAILURE');
  const bundle=aggregateImageEvidence([{fixture:{home:'A',away:'B'},visibleFields:['a','b','c','d','e','f'],visualDensity:.9,extracted:{}}]);
  assert.ok(bundle.hardFailures.includes('IMAGE_EXTRACTION_SUSPECTED_FAILURE'));
});

test('completeness gate is deterministic',()=>{
  const bundle={fixture:{home:'A',away:'B'},extracted:{homeHistory:[1],awayHistory:[1],h2h:[1],standings:{},stats:{},odds:{}}};
  const a=evidenceCompleteness(bundle),b=evidenceCompleteness(bundle);
  assert.deepEqual(a,b);
  assert.equal(a.score,100);
  assert.equal(a.action,'FULL');
});

test('strict prior rejects same-date and future evidence',()=>{
  assert.throws(()=>assertStrictPriorDate('2026-08-22','2026-08-22'),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>assertStrictPriorDate('2026-08-23','2026-08-22'),/STRICT_PRIOR_FAILURE/);
  assert.equal(assertStrictPriorDate('2026-08-21','2026-08-22'),true);
});

test('coverage marks insufficient context OOD',()=>{
  const x=assessCoverage({homePriorMatches:3,awayPriorMatches:4,dnaNeighbors:2,segment:'UNKNOWN',imageCompleteness:.2,regimeSupport:.1});
  assert.equal(x.ood,true);
  assert.ok(x.reasons.includes('LOW_DNA_SUPPORT'));
});

test('router is target-specific and selective gate avoids unsupported override',()=>{
  const experts={FUTURE_SIX:expert('FUTURE_SIX'),MATCH_DNA:expert('MATCH_DNA',{...probs,'7+ FT':.08}),REGIME:expert('REGIME',{...probs,'7+ FT':.06})};
  const routed=routeTarget({market:'7+ FT',experts,coverage:{ood:false}});
  assert.equal(routed.expert,'REGIME');
  assert.equal(routed.probability,.06);
  assert.equal(selectiveGate({championP:.03,challengerP:.06,challengerSupport:5,coverage:{ood:false}}).intervene,false);
});

test('tail conditional exposes explosion scorelines separately from main top3',()=>{
  const ht=grid(5),ft=grid(8,.45);
  const x=buildTailConditional({htGrid:ht,ftGrid:ft});
  assert.equal(x.top3HTGiven3Plus.length,3);
  assert.equal(x.top3FTGiven7Plus.length,3);
  assert.ok(x.concentration.sevenPlusFT.eventProbability>0);
});

test('tail-grid mismatch is a hard consistency failure',async()=>{
  const ht=grid(5),ft=grid(8,.45);
  const experts={FUTURE_SIX:expert('FUTURE_SIX'),HISTORICAL:expert('HISTORICAL'),MATCH_DNA:expert('MATCH_DNA'),REGIME:expert('REGIME')};
  const r=await buildFusionPrediction({targetDate:'2026-08-22',maxEvidenceDate:'2026-08-21',experts,context:{homePriorMatches:30,awayPriorMatches:30,dnaNeighbors:100,segment:'M|SENIOR|ELITE_PRO'},htGrid:ht,ftGrid:ft});
  assert.equal(r.productionEligible,false);
  assert.equal(r.shadowEligible,false);
  assert.ok(r.hardFailures.includes('TAIL_PROBABILITY_GRID_MISMATCH'));
});

test('fusion prediction is deterministic for identical input',async()=>{
  const ht=grid(5),ft=grid(8,.45);
  const tail=auditTailGrid({probabilities:{'3+ HT':0,'7+ FT':0,'Other HT':0,'Other FT':0},htGrid:[],ftGrid:[]});
  assert.equal(tail.pass,true);
  const experts={FUTURE_SIX:expert('FUTURE_SIX'),HISTORICAL:expert('HISTORICAL'),MATCH_DNA:expert('MATCH_DNA'),REGIME:expert('REGIME')};
  const args={targetDate:'2026-08-22',maxEvidenceDate:'2026-08-21',experts,context:{homePriorMatches:30,awayPriorMatches:30,dnaNeighbors:100,segment:'M|SENIOR|ELITE_PRO'},htGrid:[],ftGrid:[]};
  const a=await buildFusionPrediction(args),b=await buildFusionPrediction(args);
  assert.deepEqual(a,b);
});
