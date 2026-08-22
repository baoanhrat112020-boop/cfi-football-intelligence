import test from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_VERSION } from '../research/fusion/contracts.mjs';
import { buildFusionPrediction } from '../research/fusion/fusion-engine.mjs';

const probabilities={'3+ HT':.1,'7+ FT':.02,'Other HT':.01,'Other FT':.03};
const expert=(name,provenance)=>({expert:name,probabilities:{...probabilities},confidence:{coverage:.9,localSample:100},top3HT:[],top3FT:[],provenance});
const clean=name=>({maxEvidenceTimestamp:'2026-08-21T23:59:59.000Z',futureEvidenceCount:0,sameDateEvidenceCount:0,identityHash:'fixture:A:B:2026-08-22',provenanceHash:`clean:${name}`});
const council=override=>Object.fromEntries(['FUTURE_SIX','HISTORICAL','MATCH_DNA','REGIME'].map(name=>[name,expert(name,override?.[name]??clean(name))]));
const args=experts=>({targetDate:'2026-08-22',maxEvidenceDate:'2026-08-21',experts,context:{homePriorMatches:30,awayPriorMatches:30,dnaNeighbors:100,segment:'M|SENIOR|ELITE_PRO'},htGrid:[],ftGrid:[],modulePolicy:{enableTailConditional:false}});

test('Fusion telemetry is V1.2',()=>{
  assert.equal(FUSION_VERSION,'CFI_FUSION_RESEARCH_V1.2');
});

test('Fusion fails closed when any expert provenance is missing',async()=>{
  const experts=council();
  delete experts.MATCH_DNA.provenance;
  await assert.rejects(()=>buildFusionPrediction(args(experts)),/EXPERT_PROVENANCE_REQUIRED/);
});

test('caller aggregate maxEvidenceDate cannot hide same-date expert evidence',async()=>{
  const bad={...clean('REGIME'),maxEvidenceTimestamp:'2026-08-22T00:00:00.000Z',sameDateEvidenceCount:1};
  await assert.rejects(()=>buildFusionPrediction(args(council({REGIME:bad}))),/EXPERT_SAME_DATE_EVIDENCE_PRESENT/);
});

test('caller aggregate maxEvidenceDate cannot hide future expert evidence',async()=>{
  const bad={...clean('HISTORICAL'),maxEvidenceTimestamp:'2026-08-23T00:00:00.000Z',futureEvidenceCount:1};
  await assert.rejects(()=>buildFusionPrediction(args(council({HISTORICAL:bad}))),/EXPERT_FUTURE_EVIDENCE_PRESENT/);
});

test('verified output carries audited provenance for every expert',async()=>{
  const r=await buildFusionPrediction(args(council()));
  assert.equal(r.strictPrior.verified,true);
  assert.deepEqual(Object.keys(r.strictPrior.experts).sort(),['FUTURE_SIX','HISTORICAL','MATCH_DNA','REGIME'].sort());
  for(const p of Object.values(r.strictPrior.experts)) assert.ok(p.provenanceHash);
});
