import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, FINAL_VERSION, PRIMARY_TARGETS } from '../src/prediction/final-engine.ts';

const fixtures=[];
for(let i=0;i<24;i++){
  const d=String(i+1).padStart(2,'0');
  fixtures.push({id:`h${i}`,matchDate:`2026-07-${d}`,homeTeam:i%2?'Home':'X',awayTeam:i%2?'Y':'Home',ht:{home:i%3,away:i%2},ft:{home:2+(i%4),away:i%3}});
  fixtures.push({id:`a${i}`,matchDate:`2026-06-${d}`,homeTeam:i%2?'Away':'Z',awayTeam:i%2?'Q':'Away',ht:{home:i%2,away:i%3},ft:{home:i%3,away:1+(i%4)}});
}

test('CFI exposes six primary targets with dual scoreline methods',()=>{
  const p=buildPrediction({home:'Home',away:'Away',targetDate:'2026-08-19',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:[]});
  assert.equal(FINAL_VERSION,'CFI_FINAL_V5.1.0');
  assert.equal(PRIMARY_TARGETS.length,6);
  assert.equal(p.primaryTargets.count,6);
  for(const side of ['ht','ft']){
    assert.equal(p.scoreline[side].methodA.length,3);
    assert.equal(p.scoreline[side].methodB.length,3);
    assert.equal(p.scoreline[side].final.length,3);
  }
  for(const m of ['3+ HT','7+ FT','Other HT','Other FT']){
    assert.ok(Number.isFinite(p.markets[m].methodA));
    assert.ok(Number.isFinite(p.markets[m].methodB));
    assert.ok(Number.isFinite(p.markets[m].final));
    assert.equal(p.markets[m].consistency.status,'PASS');
    assert.equal(p.markets[m].consistency.finalDelta,0);
  }
  assert.deepEqual(p.ranking.map(x=>x.target).sort(),['3+ HT','7+ FT','Other FT','Other HT','Top-3 FT','Top-3 HT'].sort());
});
