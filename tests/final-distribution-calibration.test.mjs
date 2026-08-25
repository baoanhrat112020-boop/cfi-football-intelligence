import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction, MARKET_CODES } from '../src/prediction/final-engine.ts';

const fixtures=[];
for(let i=0;i<96;i++){
  const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
  const home=i%2===0?'Alpha':'Beta',away=i%2===0?'Beta':'Alpha';
  const rare=i%24===0;
  const ht=rare?{home:4,away:0}:{home:i%4===0?1:0,away:i%7===0?1:0};
  const ft=rare?{home:7,away:1}:{home:ht.home+1,away:ht.away+1};
  fixtures.push({id:String(i),matchDate:d,homeTeam:home,awayTeam:away,ht,ft});
}

test('FINAL is calibrated through the complete score distribution, not raw structural mass',()=>{
  const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});
  for(const market of MARKET_CODES){
    const row=p.markets[market];
    assert.equal(row.calibration.version,'final-score-distribution-calibration-v2');
    assert.equal(row.calibration.converged,true);
    assert.equal(row.final,row.scorelineMass);
    assert.ok(Math.abs(row.final-row.calibration.target)<1e-8,`${market} missed calibrated target`);
    assert.ok(Math.abs(row.final-row.rawRate)<=0.14000001,`${market} escaped empirical calibration envelope`);
  }
  assert.ok(p.markets['Other HT'].final<=p.markets['3+ HT'].final+1e-12);
  assert.equal(p.scoreline.distributionCalibration.ht.converged,true);
  assert.equal(p.scoreline.distributionCalibration.ft.converged,true);
});

test('rare-tail FINAL no longer aliases the pre-calibration score-grid mass',()=>{
  const p=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-01-01',language:'en',homePayload:fixtures,awayPayload:fixtures,h2hPayload:fixtures});
  const changed=MARKET_CODES.filter(m=>Math.abs(p.markets[m].final-p.markets[m].calibration.rawFinal)>1e-6);
  assert.ok(changed.length>=1,'expected at least one market to be reweighted by empirical calibration');
});
