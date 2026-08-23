import test from 'node:test';
import assert from 'node:assert/strict';
import { K031_CONFORMAL_FLOOR_CONTRACT, runK031ConformalFloor } from '../research/conformal-floor-runner.mjs';

const markets=['3+ HT','7+ FT','Other HT','Other FT'];
const lastValues=Object.fromEntries(markets.map((m,i)=>[m,.35-i*.05]));
const rows=markets.flatMap((market,mi)=>Array.from({length:30},(_,i)=>({
  market,
  targetDate:`2026-07-${String((i%28)+1).padStart(2,'0')}`,
  residual:.02+mi*.01+(i%5)*.005,
})));

test('K031 conformal floor is training-free, strict-prior, research-only and deterministic',()=>{
  const input={targetDate:'2026-08-19',maxEvidenceDate:'2026-08-18',lastValues,rows,minPrior:30,alpha:.10};
  const a=runK031ConformalFloor(input);
  const b=runK031ConformalFloor({...input,rows:[...rows].reverse()});
  assert.equal(K031_CONFORMAL_FLOOR_CONTRACT.trainingFree,true);
  assert.equal(a.baselineLock,'R0_IMMUTABLE');
  assert.equal(a.productionEligible,false);
  assert.equal(a.decisionUse,false);
  assert.deepEqual(a.markets,b.markets);
  for(const market of markets){
    assert.equal(a.markets[market].priorCount,30);
    assert.ok(a.markets[market].interval.lower>=0);
    assert.ok(a.markets[market].interval.upper<=1);
  }
});

test('K031 rejects same-date leakage and insufficient prior support',()=>{
  assert.throws(()=>runK031ConformalFloor({targetDate:'2026-08-19',maxEvidenceDate:'2026-08-19',lastValues,rows}),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>runK031ConformalFloor({targetDate:'2026-08-19',maxEvidenceDate:'2026-08-18',lastValues,rows:rows.slice(0,4),minPrior:30}),/K031_INSUFFICIENT_PRIOR_RESIDUALS/);
});
