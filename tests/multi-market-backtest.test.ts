import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketReplayPoints, walkForwardMultiMarketBacktest } from '../src/prediction/multi-market-backtest.ts';
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
  const result:any=walkForwardMultiMarketBacktest(fixtures());
  assert.equal(result.version,'CFI_MULTI_MARKET_WALK_FORWARD_V2');
  assert.equal(result.status,'RESEARCH_ONLY');
  assert.equal(result.strictPrior,true);
  assert.equal(result.sameDateExcluded,true);
  assert.equal(result.leakage,false);
  assert.equal(result.decisionUse,false);
  assert.equal(result.minTeamPrior,1);
  assert.equal(result.historyCap,10);
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
  const a=walkForwardMultiMarketBacktest(fixtures());
  const b=walkForwardMultiMarketBacktest([...fixtures()].reverse());
  assert.deepEqual(a,b);
});

test('replay supports stricter evidence sensitivity and excludes same-date evidence',()=>{
  const rows:CanonicalFixture[]=[
    ...Array.from({length:12},(_,i)=>({id:`a-${i}`,matchDate:`2025-01-${String(i+1).padStart(2,'0')}`,homeTeam:'Alpha',awayTeam:'Gamma',ht:{home:1,away:0},ft:{home:2,away:0}})),
    ...Array.from({length:7},(_,i)=>({id:`b-${i}`,matchDate:`2025-02-${String(i+1).padStart(2,'0')}`,homeTeam:'Beta',awayTeam:'Gamma',ht:{home:1,away:0},ft:{home:2,away:1}})),
    {id:'target-too-early',matchDate:'2025-03-01',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:1},ft:{home:2,away:1}},
    {id:'b-extra-1',matchDate:'2025-03-02',homeTeam:'Beta',awayTeam:'Gamma',ht:{home:0,away:0},ft:{home:1,away:0}},
    {id:'target-ok',matchDate:'2025-03-03',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:0},ft:{home:2,away:0}},
    {id:'same-day',matchDate:'2025-03-03',homeTeam:'Beta',awayTeam:'Gamma',ht:{home:4,away:0},ft:{home:6,away:0}},
  ];
  const strict8=buildMultiMarketReplayPoints(rows,8,10);
  assert.equal(strict8.some(r=>r.fixtureId==='target-too-early'),false);
  const target=strict8.find(r=>r.fixtureId==='target-ok');
  assert.ok(target);
  assert.ok(target!.homePriorCount>=8);
  assert.ok(target!.awayPriorCount>=8);
  assert.ok(target!.homePriorCount<=10);
  assert.ok(target!.awayPriorCount<=10);
  assert.ok(target!.maxEvidenceDate<'2025-03-03');

  const benchmarkProtocol=buildMultiMarketReplayPoints(rows,1,10);
  assert.ok(benchmarkProtocol.length>=strict8.length);
  assert.ok(benchmarkProtocol.every(r=>r.homePriorCount>=1&&r.awayPriorCount>=1));
  assert.ok(benchmarkProtocol.every(r=>r.homePriorCount<=10&&r.awayPriorCount<=10));
});
