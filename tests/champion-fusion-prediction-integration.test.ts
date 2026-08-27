import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction } from '../src/prediction/final-engine.ts';
import { buildCfiOutputV3 } from '../src/presentation/cfi-output-v3.ts';

function history(){
  const rows:any[]=[];
  for(let i=1;i<=16;i++){
    const day=String(i).padStart(2,'0');
    rows.push({id:`h${i}`,matchDate:`2026-07-${day}`,homeTeam:'Alpha',awayTeam:`H${i}`,ht:{home:i%3,away:i%2},ft:{home:1+(i%4),away:i%3}});
    rows.push({id:`a${i}`,matchDate:`2026-07-${day}`,homeTeam:`A${i}`,awayTeam:'Beta',ht:{home:i%2,away:(i+1)%3},ft:{home:i%3,away:1+((i+2)%4)}});
  }
  rows.push({id:'hh1',matchDate:'2026-07-20',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:0},ft:{home:2,away:1}});
  rows.push({id:'hh2',matchDate:'2026-07-25',homeTeam:'Beta',awayTeam:'Alpha',ht:{home:0,away:1},ft:{home:1,away:2}});
  return rows;
}

test('official prediction persists coherent Champion Fusion shadow',()=>{
  const rows=history();
  const prediction:any=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-08-01',language:'vi',homePayload:rows,awayPayload:rows,h2hPayload:rows.filter(x=>(x.homeTeam==='Alpha'&&x.awayTeam==='Beta')||(x.homeTeam==='Beta'&&x.awayTeam==='Alpha'))});
  assert.equal(prediction.status,'DATA_READY');
  assert.equal(prediction.championFusion.version,'CFI_MULTI_MARKET_CHAMPION_FUSION_V1');
  assert.equal(prediction.championFusion.decisionUse,false);
  assert.equal(prediction.championFusion.strictPrior.verified,true);
  assert.equal(prediction.championFusion.multiMarket.consistencyGuard.status,'PASS');
  assert.ok(prediction.championFusion.activeExperts.includes('FUTURE_SIX'));
  assert.ok(prediction.championFusion.activeExperts.includes('HISTORICAL'));
  assert.ok(prediction.championFusion.activeExperts.includes('INCUMBENT_FINAL'));
  assert.equal(prediction.championFusion.candidateExperts.F10P,'HISTORICAL_V2_INCOMPLETE');
  const output:any=buildCfiOutputV3(prediction,{input_mode:'SINGLE_MATCH'});
  assert.equal(output.championFusion.version,'CFI_MULTI_MARKET_CHAMPION_FUSION_V1');
  assert.equal(output.championFusion.decisionUse,false);
  assert.match(output.renderedPracticalReport,/CHAMPION FUSION:/);
});
