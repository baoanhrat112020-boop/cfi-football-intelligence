import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction } from '../src/prediction/final-engine.ts';
import { MULTI_MARKET_RESEARCH_GRID_SYMBOL } from '../src/prediction/multi-market-v1.ts';

const row=(id:string,date:string,home:string,away:string,ht:string,ft:string)=>({id,matchDate:date,homeTeam:home,awayTeam:away,ht,ft});
const mirror=(r:any)=>({
  ...r,
  homeTeam:r.awayTeam,
  awayTeam:r.homeTeam,
  ht:typeof r.ht==='string'?r.ht.split('-').reverse().join('-'):{home:r.ht.away,away:r.ht.home},
  ft:typeof r.ft==='string'?r.ft.split('-').reverse().join('-'):{home:r.ft.away,away:r.ft.home},
});

const homeRows=[
  row('h1','2025-01-01','Home','X','1-0','2-0'),
  row('h2','2025-01-11','Y','Home','0-1','1-2'),
  row('h3','2025-02-03','Home','Z','2-0','3-1'),
  row('h4','2025-03-07','W','Home','1-1','2-2'),
];
const awayRows=[
  row('a1','2025-01-04','Away','M','0-1','1-2'),
  row('a2','2025-01-19','N','Away','1-1','1-3'),
  row('a3','2025-02-12','Away','P','1-0','2-1'),
  row('a4','2025-03-15','Q','Away','0-2','1-4'),
];
const h2hRows=[
  row('x1','2025-02-20','Home','Away','1-1','2-1'),
  row('x2','2025-03-20','Away','Home','0-1','1-2'),
];

function gridMap(rows:any[]){return new Map(rows.map(r=>[`${r.home}-${r.away}`,r.probability]));}
function assertMirrored(a:any[],b:any[],tol=1e-10){
  const mb=gridMap(b);
  assert.equal(a.length,b.length);
  for(const r of a){
    const q=mb.get(`${r.away}-${r.home}`);
    assert.equal(typeof q,'number');
    assert.ok(Math.abs(r.probability-q!)<=tol,`${r.home}-${r.away}: ${r.probability} vs ${q}`);
  }
}

test('FINAL V5.3.1 is invariant under complete HOME/AWAY relabeling',()=>{
  const direct:any=buildPrediction({home:'Home',away:'Away',targetDate:'2025-04-01',language:'en',homePayload:homeRows,awayPayload:awayRows,h2hPayload:h2hRows});
  const swapped:any=buildPrediction({home:'Away',away:'Home',targetDate:'2025-04-01',language:'en',homePayload:awayRows.map(mirror),awayPayload:homeRows.map(mirror),h2hPayload:h2hRows.map(mirror)});
  const gd=direct.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  const gs=swapped.multiMarket[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  assert.ok(gd?.ht?.length&&gd?.ft?.length&&gs?.ht?.length&&gs?.ft?.length);
  assertMirrored(gd.ht,gs.ht);
  assertMirrored(gd.ft,gs.ft);
  assert.ok(Math.abs(direct.multiMarket.oneXTwo.ht.home-swapped.multiMarket.oneXTwo.ht.away)<=1e-10);
  assert.ok(Math.abs(direct.multiMarket.oneXTwo.ht.draw-swapped.multiMarket.oneXTwo.ht.draw)<=1e-10);
  assert.ok(Math.abs(direct.multiMarket.oneXTwo.ft.home-swapped.multiMarket.oneXTwo.ft.away)<=1e-10);
  assert.ok(Math.abs(direct.multiMarket.oneXTwo.ft.draw-swapped.multiMarket.oneXTwo.ft.draw)<=1e-10);
  assert.deepEqual(direct.multiMarket.overUnder,swapped.multiMarket.overUnder);
  assert.equal(direct.multiMarket.consistencyGuard.status,'PASS');
  assert.equal(swapped.multiMarket.consistencyGuard.status,'PASS');
});
