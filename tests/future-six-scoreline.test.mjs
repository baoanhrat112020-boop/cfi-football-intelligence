import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFutureSixScorelines } from '../src/prediction/future-six-scoreline.ts';

function fx(date,home,away,ht,ft){return {matchDate:date,homeTeam:home,awayTeam:away,ht,ft};}
const homeRows=[
 fx('2026-01-01','Alpha','X',{home:2,away:0},{home:5,away:0}),
 fx('2026-01-08','Y','Alpha',{home:0,away:2},{home:1,away:4}),
 fx('2026-01-15','Alpha','Z',{home:3,away:0},{home:6,away:1}),
 fx('2026-01-22','Q','Alpha',{home:1,away:2},{home:2,away:5}),
 fx('2026-01-29','Alpha','W',{home:2,away:1},{home:5,away:2}),
];
const awayRows=[
 fx('2026-01-02','Beta','M',{home:0,away:2},{home:1,away:5}),
 fx('2026-01-09','N','Beta',{home:2,away:0},{home:5,away:1}),
 fx('2026-01-16','Beta','P',{home:1,away:2},{home:2,away:5}),
 fx('2026-01-23','R','Beta',{home:2,away:0},{home:6,away:0}),
 fx('2026-01-30','Beta','S',{home:1,away:1},{home:1,away:4}),
];

test('Future Six score grids are deterministic and normalized',()=>{
  const a=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows,awayRows});
  const b=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows:structuredClone(homeRows),awayRows:structuredClone(awayRows)});
  assert.deepEqual(a,b);
  assert.ok(Math.abs(a.ht.reduce((s,r)=>s+r.probability,0)-1)<1e-10);
  assert.ok(Math.abs(a.ft.reduce((s,r)=>s+r.probability,0)-1)<1e-10);
  assert.equal(a.top3HT.length,3); assert.equal(a.top3FT.length,3);
});

test('six factors stay bounded and directional dominance is preserved',()=>{
  const r=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows,awayRows});
  for(const [k,v] of Object.entries(r.factors)){
    if(k==='dominance') assert.ok(v>=-1&&v<=1); else assert.ok(v>=0&&v<=1,`${k}=${v}`);
  }
  assert.ok(Number.isFinite(r.intensity.ftHome));
  assert.ok(Number.isFinite(r.intensity.ftAway));
});

test('collapse and volatility materially change the Model B tail',()=>{
  const volatile=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows,awayRows});
  const calmRows=awayRows.map(r=>fx(r.matchDate,r.homeTeam,r.awayTeam,{home:0,away:0},{home:1,away:1}));
  const calm=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows,awayRows:calmRows});
  const tail=g=>g.filter(r=>r.total>=7||r.home>=5||r.away>=5).reduce((s,r)=>s+r.probability,0);
  assert.notEqual(volatile.factors.extremeScorePressure,calm.factors.extremeScorePressure);
  assert.notEqual(tail(volatile.ft),tail(calm.ft));
});

test('Future Six Top-3 comes from its own score distribution',()=>{
  const r=buildFutureSixScorelines({home:'Alpha',away:'Beta',homeRows,awayRows});
  const expected=[...r.ft].sort((a,b)=>b.probability-a.probability).slice(0,3).map(x=>x.score);
  assert.deepEqual(r.top3FT.map(x=>x.score),expected);
  assert.equal(r.version,'CFI_FUTURE_SIX_SCORELINE_V0.1');
});
