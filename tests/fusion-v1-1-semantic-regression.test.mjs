import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImageState, normalizeImageEvidence, aggregateImageEvidence, evidenceCompleteness } from '../research/fusion/image/image-evidence.mjs';
import { makeExpert } from '../research/fusion/experts.mjs';

const validProbabilities={'3+ HT':.2,'7+ FT':.04,'Other HT':.01,'Other FT':.05};

test('market labels HT/FT are not treated as match-state evidence',()=>{
  assert.notEqual(classifyImageState({visibleText:'Other HT 12.50'}),'HALFTIME');
  assert.notEqual(classifyImageState({visibleText:'3+ HT 2.80'}),'HALFTIME');
  assert.notEqual(classifyImageState({visibleText:'Other FT 25.00'}),'FINISHED');
  assert.notEqual(classifyImageState({visibleText:'7+ FT 8.20'}),'FINISHED');
  assert.equal(classifyImageState({visibleText:'Other HT 12.50 | Other FT 25.00'}),'ODDS');
});

test('explicit HT/FT score context can identify match state',()=>{
  assert.equal(classifyImageState({visibleText:'HT 2-1'}),'HALFTIME');
  assert.equal(classifyImageState({visibleText:'FT 4-2'}),'FINISHED');
  assert.equal(classifyImageState({visibleText:'Half Time 2-1'}),'HALFTIME');
  assert.equal(classifyImageState({visibleText:'Full Time 4-2'}),'FINISHED');
});

test('countdown remains prematch even when market labels contain HT and FT',()=>{
  const text='Kick off in 00:03:20 | 3+ HT 2.80 | Other FT 25.00';
  const row=normalizeImageEvidence({visibleText:text,fixture:{home:'A',away:'B'},extracted:{odds:{threePlusHT:2.8,otherFT:25}}});
  assert.equal(row.imageState,'PREMATCH_COUNTDOWN');
  assert.equal(row.strictPriorEligible,true);
  assert.equal(row.liveEvidenceAllowed,false);
});

test('live evidence is excluded from prematch aggregation',()=>{
  const bundle=aggregateImageEvidence([
    {imageState:'TEAM_HISTORY',fixture:{home:'A',away:'B'},extracted:{homeHistory:[1,2],awayHistory:[3,4]}},
    {imageState:'PREMATCH_COUNTDOWN',fixture:{home:'A',away:'B'},extracted:{odds:{x:2}}},
    {imageState:'LIVE_1H',fixture:{home:'A',away:'B'},extracted:{liveShots:{home:7,away:1},score:'1-0'}},
  ]);
  assert.equal(bundle.liveEvidenceUsed,false);
  assert.equal(bundle.excludedLiveEvidence,1);
  assert.equal(bundle.extracted.liveShots,undefined);
  assert.equal(bundle.extracted.score,undefined);
  assert.deepEqual(bundle.extracted.homeHistory,[1,2]);
  assert.deepEqual(bundle.extracted.odds,{x:2});
});

test('conflicting fixture identities fail closed',()=>{
  const bundle=aggregateImageEvidence([
    {imageState:'TEAM_HISTORY',fixture:{home:'A',away:'B'},extracted:{homeHistory:[1]}},
    {imageState:'H2H',fixture:{home:'A',away:'C'},extracted:{h2h:[2]}},
  ]);
  assert.ok(bundle.hardFailures.includes('FIXTURE_IDENTITY_CONFLICT'));
  assert.equal(evidenceCompleteness(bundle).action,'FAIL_CLOSED');
});

test('suspected extraction failure forces completeness fail-closed',()=>{
  const bundle=aggregateImageEvidence([
    {imageState:'PREMATCH_COUNTDOWN',fixture:{home:'A',away:'B'},visibleFields:['fixture','form','h2h','standings','stats','odds'],visualDensity:.9,extracted:{}},
  ]);
  assert.ok(bundle.hardFailures.includes('IMAGE_EXTRACTION_SUSPECTED_FAILURE'));
  assert.equal(evidenceCompleteness(bundle).action,'FAIL_CLOSED');
});

test('expert adapter rejects missing or invalid market probabilities instead of coercing to zero',()=>{
  assert.throws(()=>makeExpert('BAD',{probabilities:{'3+ HT':.2,'7+ FT':.04,'Other HT':.01}}),/INVALID_PROBABILITY:Other FT/);
  assert.throws(()=>makeExpert('BAD',{probabilities:{...validProbabilities,'7+ FT':null}}),/INVALID_PROBABILITY:7\+ FT/);
  assert.throws(()=>makeExpert('BAD',{probabilities:{...validProbabilities,'Other FT':1.2}}),/INVALID_PROBABILITY:Other FT/);
  const ok=makeExpert('OK',{probabilities:validProbabilities});
  assert.equal(ok.probabilities['Other FT'],.05);
});
