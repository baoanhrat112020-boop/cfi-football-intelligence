import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction } from '../src/prediction/final-engine.ts';

const rows=[
  ['2026-01-01','Alpha','Gamma',1,0,2,0],['2026-01-08','Beta','Delta',0,1,1,2],
  ['2026-01-15','Alpha','Delta',1,1,3,1],['2026-01-22','Gamma','Beta',0,0,1,1],
  ['2026-02-01','Alpha','Gamma',2,0,4,1],['2026-02-08','Beta','Delta',1,1,2,2],
  ['2026-02-15','Alpha','Delta',0,1,2,2],['2026-02-22','Gamma','Beta',1,0,1,0],
  ['2026-03-01','Alpha','Gamma',2,1,3,2],['2026-03-08','Beta','Delta',0,0,1,1],
  ['2026-03-15','Alpha','Delta',1,0,2,0],['2026-03-22','Gamma','Beta',1,1,2,3],
].map(([matchDate,homeTeam,awayTeam,hh,ha,fh,fa],i)=>({id:String(i),matchDate,homeTeam,awayTeam,ht:{home:Number(hh),away:Number(ha)},ft:{home:Number(fh),away:Number(fa)}}));

test('final prediction persists full Multi-Market from the same calibrated score distribution',()=>{
  const p:any=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-04-01',language:'en',homePayload:rows,awayPayload:rows,h2hPayload:rows});
  assert.equal(p.status,'DATA_READY');
  assert.equal(p.multiMarket?.version,'CFI_MULTI_MARKET_V1');
  assert.equal(p.multiMarket?.decisionUse,false);
  assert.equal(p.multiMarket?.model?.source,'FINAL_CALIBRATED_SCORE_DISTRIBUTION');
  assert.equal(p.multiMarket?.model?.singleCore,true);
  assert.equal(p.multiMarket?.consistencyGuard?.status,'PASS');
  assert.ok(p.multiMarket?.oneXTwo?.ht && p.multiMarket?.oneXTwo?.ft);
  assert.ok(p.multiMarket?.overUnder?.ht?.['2.5'] && p.multiMarket?.overUnder?.ft?.['6.5']);
  assert.ok(p.multiMarket?.asianHandicap?.ht?.['-0.25'] && p.multiMarket?.asianHandicap?.ft?.['0.25']);
  assert.ok(Math.abs(p.markets['3+ HT'].final-p.multiMarket.overUnder.ht['2.5'].over.fullWin)<1e-9);
  assert.ok(Math.abs(p.markets['7+ FT'].final-p.multiMarket.overUnder.ft['6.5'].over.fullWin)<1e-9);
});
