import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, MARKET_CODES, MAX_MARKET_SCORELINE_DELTA } from '../src/prediction/final-engine.ts';

const fixtures=[];
for(let i=0;i<80;i++){
  const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
  const home=i%2===0?'Alpha':'Beta';
  const away=i%2===0?'Beta':'Alpha';
  const ht=i%9===0?{home:3,away:1}:{home:i%3===0?1:0,away:i%5===0?1:0};
  const ft=i%11===0?{home:5,away:3}:{home:ht.home+1,away:ht.away+1};
  fixtures.push({id:String(i),matchDate:d,homeTeam:home,awayTeam:away,ht,ft});
}

test('all four final market probabilities are constrained to full score-distribution mass',()=>{
  const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});
  assert.equal(p.scoreline.consistencyGate.scope,'FULL_SCORE_DISTRIBUTION');
  assert.equal(p.scoreline.consistencyGate.top3UsedForGate,false);
  assert.equal(p.scoreline.consistencyGate.allFinalWithinTolerance,true);
  for(const market of MARKET_CODES){
    const row=p.markets[market];
    const mass=p.scoreline.marketMass[market];
    assert.ok(Math.abs(row.final-mass)<=MAX_MARKET_SCORELINE_DELTA+1e-12,`${market} final must track full score grid`);
    assert.equal(row.methodB,mass,`${market} structural method must be exact full-grid integral`);
  }
});

test('Top-3 scorelines are presentation only and never used by consistency gate',()=>{
  const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});
  assert.equal(p.scoreline.ht.length,3);
  assert.equal(p.scoreline.ft.length,3);
  assert.equal(p.scoreline.consistencyGate.top3UsedForGate,false);
});

test('a reconciled market is downgraded and cannot silently remain a strong signal',()=>{
  const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});
  for(const market of MARKET_CODES){
    const row=p.markets[market];
    if(row.consistency.reconciled){
      assert.equal(row.confidence,'LOW');
      assert.ok(row.opposingFactors.includes('GLOBAL_SCORELINE_MARKET_CONFLICT'));
      assert.ok(p.scoreline.consistencyWarnings.some(x=>x.startsWith(market+':')));
    }
  }
});
