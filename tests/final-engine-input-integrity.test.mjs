import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, normalizeFixtures, normalizePair } from '../src/prediction/final-engine.ts';

test('score adapter accepts only non-negative integer football scores',()=>{
  assert.deepEqual(normalizePair([2,1]),{home:2,away:1});
  assert.deepEqual(normalizePair({homeGoals:'3',awayGoals:'2'}),{home:3,away:2});
  assert.equal(normalizePair([1.5,0]),null);
  assert.equal(normalizePair({home:1,away:2.25}),null);
  assert.equal(normalizePair('1.5-0'),null);
  assert.equal(normalizePair([-1,0]),null);
});

test('fractional source scores are treated as missing and never enter score coverage',()=>{
  const rows=normalizeFixtures([{
    id:'fractional',matchDate:'2026-08-01',homeTeam:'A',awayTeam:'B',
    ht:{home:1.5,away:0},ft:{home:2,away:1}
  }]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].ht,null);
  assert.deepEqual(rows[0].ft,{home:2,away:1});
  const prediction=buildPrediction({home:'A',away:'B',targetDate:'2026-08-22',homePayload:rows,awayPayload:[],h2hPayload:[],language:'en'});
  assert.equal(prediction.evidence.htCoverage,0);
  assert.equal(prediction.evidence.ftCoverage,1);
  assert.equal(prediction.markets['3+ HT'].eligible,0);
  assert.equal(prediction.markets['7+ FT'].eligible,1);
});

test('market calibration telemetry reports the reconciliation weights actually used by its score grid',()=>{
  const homeHistory=Array.from({length:18},(_,i)=>({
    id:`h${i}`,matchDate:`2025-01-${String(i+1).padStart(2,'0')}`,
    homeTeam:i%2?'WeakHome':'X',awayTeam:i%2?'X':'WeakHome',
    ht:i%2?'0-0':'0-0',ft:i%2?'0-3':'3-0'
  }));
  const awayHistory=Array.from({length:18},(_,i)=>({
    id:`a${i}`,matchDate:`2025-02-${String(i+1).padStart(2,'0')}`,
    homeTeam:i%2?'StrongAway':'Y',awayTeam:i%2?'Y':'StrongAway',
    ht:i%2?'0-0':'0-0',ft:i%2?'4-0':'0-4'
  }));
  const result=buildPrediction({home:'WeakHome',away:'StrongAway',targetDate:'2025-04-01',homePayload:homeHistory,awayPayload:awayHistory,h2hPayload:[],language:'en'});
  assert.equal(result.scoreline.reconciliation.ht.direction,'BALANCED');
  assert.equal(result.scoreline.reconciliation.ft.direction,'AWAY');
  for(const market of ['3+ HT','Other HT']){
    assert.equal(result.markets[market].calibration.weightA,result.scoreline.reconciliation.ht.scorelineWeightA);
    assert.equal(result.markets[market].calibration.weightB,result.scoreline.reconciliation.ht.scorelineWeightB);
  }
  for(const market of ['7+ FT','Other FT']){
    assert.equal(result.markets[market].calibration.weightA,result.scoreline.reconciliation.ft.scorelineWeightA);
    assert.equal(result.markets[market].calibration.weightB,result.scoreline.reconciliation.ft.scorelineWeightB);
  }
  assert.notEqual(result.markets['7+ FT'].calibration.weightA,result.markets['7+ FT'].calibration.baseWeightA);
});
