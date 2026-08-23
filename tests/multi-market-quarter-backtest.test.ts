import test from 'node:test';
import assert from 'node:assert/strict';
import { walkForwardQuarterAhBacktest, QUARTER_AH_LINES } from '../src/prediction/multi-market-quarter-backtest.ts';
import type { CanonicalFixture } from '../src/prediction/final-engine.ts';

function fixtures():CanonicalFixture[]{return Array.from({length:30},(_,i)=>({
 id:`q-${i}`,matchDate:`2026-${i<15?'05':'06'}-${String((i%15)+1).padStart(2,'0')}`,
 homeTeam:i%2===0?'Alpha':'Beta',awayTeam:i%2===0?'Beta':'Alpha',
 ht:i%6===0?{home:2,away:2}:i%3===0?{home:0,away:1}:{home:1,away:0},
 ft:i%7===0?{home:3,away:3}:i%4===0?{home:1,away:3}:{home:2,away:1},
}));}

test('quarter AH replay scores all five-state distributions under strict prior',()=>{
 const r:any=walkForwardQuarterAhBacktest(fixtures());
 assert.equal(r.status,'RESEARCH_ONLY');assert.equal(r.decisionUse,false);assert.equal(r.strictPrior,true);assert.equal(r.leakage,false);assert.equal(r.productionEligible,false);
 assert.ok(r.evaluatedMatches>0);assert.deepEqual(r.lines,[...QUARTER_AH_LINES]);
 assert.deepEqual(r.settlementStates,['FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS']);
 for(const part of ['ht','ft'])for(const line of QUARTER_AH_LINES)for(const side of ['home','away']){
  const m=r.asianHandicap[part][String(line)][side];assert.ok(m.n>0);assert.ok(m.brier>=0&&m.brier<=1);assert.ok(m.logLoss>=0);
 }
});

test('quarter AH replay is deterministic and input-order invariant',()=>{
 const a=walkForwardQuarterAhBacktest(fixtures());const b=walkForwardQuarterAhBacktest([...fixtures()].reverse());assert.deepEqual(a,b);
});

test('same-date rows cannot become evidence for one another',()=>{
 const rows:CanonicalFixture[]=[
  ...Array.from({length:4},(_,i)=>({id:`a-${i}`,matchDate:`2025-01-0${i+1}`,homeTeam:'Alpha',awayTeam:'Gamma',ht:{home:1,away:0},ft:{home:2,away:0}})),
  ...Array.from({length:4},(_,i)=>({id:`b-${i}`,matchDate:`2025-01-0${i+1}`,homeTeam:'Beta',awayTeam:'Gamma',ht:{home:0,away:1},ft:{home:1,away:2}})),
  {id:'target',matchDate:'2025-02-01',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:1},ft:{home:2,away:2}},
  {id:'same-day',matchDate:'2025-02-01',homeTeam:'Beta',awayTeam:'Gamma',ht:{home:5,away:0},ft:{home:8,away:0}},
 ];
 const r=walkForwardQuarterAhBacktest(rows,1,10);assert.ok(r.maxEvidenceDate);assert.ok(r.maxEvidenceDate!<'2025-02-01');
});
