import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketFromScoreGrids, MULTI_MARKET_RESEARCH_GRID_SYMBOL } from '../src/prediction/multi-market-v1.ts';

const ht=[
  {score:'0-0',probability:.4},{score:'1-0',probability:.3},{score:'0-1',probability:.2},{score:'1-1',probability:.1},
];
const ft=[
  {score:'1-0',probability:.3},{score:'1-1',probability:.25},{score:'2-1',probability:.25},{score:'0-1',probability:.2},
];

test('research full-grid telemetry is available but non-enumerable and absent from production JSON',()=>{
  const out:any=buildMultiMarketFromScoreGrids({ht,ft});
  const descriptor=Object.getOwnPropertyDescriptor(out,MULTI_MARKET_RESEARCH_GRID_SYMBOL);
  assert.ok(descriptor);
  assert.equal(descriptor?.enumerable,false);
  assert.equal(descriptor?.writable,false);
  assert.equal(descriptor?.configurable,false);
  assert.equal(JSON.stringify(out).includes('CFI_MULTI_MARKET_RESEARCH_SCORE_GRIDS_V1'),false);
  assert.equal(Object.keys(out).includes('researchTelemetry'),false);
  const grids=out[MULTI_MARKET_RESEARCH_GRID_SYMBOL];
  assert.equal(grids.ht.length,ht.length);
  assert.equal(grids.ft.length,ft.length);
  assert.ok(Math.abs(grids.ht.reduce((s:number,r:any)=>s+r.probability,0)-1)<1e-12);
  assert.ok(Math.abs(grids.ft.reduce((s:number,r:any)=>s+r.probability,0)-1)<1e-12);
});

test('hidden telemetry does not alter public multi-market numerics',()=>{
  const out:any=buildMultiMarketFromScoreGrids({ht,ft});
  assert.equal(out.consistencyGuard.status,'PASS');
  assert.ok(Math.abs(out.oneXTwo.ht.home-.3)<1e-12);
  assert.ok(Math.abs(out.oneXTwo.ht.draw-.5)<1e-12);
  assert.ok(Math.abs(out.oneXTwo.ht.away-.2)<1e-12);
  assert.equal(out.derivedChecks.htOver2_5,0);
});
