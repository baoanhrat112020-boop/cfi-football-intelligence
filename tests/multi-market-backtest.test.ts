import test from 'node:test';
import assert from 'node:assert/strict';
import { walkForwardMultiMarketBacktest } from '../src/prediction/multi-market-backtest.ts';
import type { CanonicalFixture } from '../src/prediction/final-engine.ts';

function fixtures():CanonicalFixture[]{
  return Array.from({length:24},(_,i)=>({
    id:`bt-${i}`,
    matchDate:`2026-${String(i<12?5:6).padStart(2,'0')}-${String((i%12)+1).padStart(2,'0')}`,
    homeTeam:i%2===0?'Alpha':'Beta',
    awayTeam:i%2===0?'Beta':'Alpha',
    ht:i%5===0?{home:2,away:1}:i%3===0?{home:0,away:1}:{home:1,away:0},
    ft:i%5===0?{home:4,away:2}:i%4===0?{home:1,away:3}:{home:2,away:1},
  }));
}

test('strict-prior multi-market benchmark produces bounded out-of-sample metrics',()=>{
  const result:any=walkForwardMultiMarketBacktest(fixtures(),8);
  assert.equal(result.version,'CFI_MULTI_MARKET_WALK_FORWARD_V1');
  assert.equal(result.status,'RESEARCH_ONLY');
  assert.equal(result.strictPrior,true);
  assert.equal(result.leakage,false);
  assert.equal(result.decisionUse,false);
  assert.ok(result.evaluatedMatches>0);
  for(const part of ['ht','ft']){
    assert.ok(result.oneXTwo[part].n>0);
    assert.ok(result.oneXTwo[part].brier>=0&&result.oneXTwo[part].brier<=1);
  }
  for(const group of ['overUnder','asianHandicap'])for(const part of ['ht','ft'])for(const row of Object.values(result[group][part]) as any[]){
    assert.ok(row.n>0);
    assert.ok(row.brier>=0&&row.brier<=1);
    assert.ok(row.prevalence>=0&&row.prevalence<=1);
  }
});

test('benchmark is deterministic and does not depend on input ordering',()=>{
  const a=walkForwardMultiMarketBacktest(fixtures(),8);
  const b=walkForwardMultiMarketBacktest([...fixtures()].reverse(),8);
  assert.deepEqual(a,b);
});
