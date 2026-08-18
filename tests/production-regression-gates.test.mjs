import test from 'node:test';
import assert from 'node:assert/strict';
import { strictPriorOnlineTournament } from '../src/prediction/calibration-learning.ts';

function fixtures(n=180){
  const out=[];
  for(let i=0;i<n;i++){
    const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
    const home=i%2===0?'Alpha':'Beta', away=i%2===0?'Beta':'Alpha';
    const h=i%13===0?5:i%7===0?3:i%3===0?2:1;
    const a=i%17===0?5:i%11===0?4:i%4===0?2:0;
    out.push({id:String(i),matchDate:d,homeTeam:home,awayTeam:away,ht:{home:Math.min(h,4),away:Math.min(a,4)},ft:{home:h,away:a}});
  }
  return out;
}

function fingerprint(result){
  return JSON.stringify({learner:result.learner,strictPrior:result.strictPrior,markets:result.markets,promotion:result.promotion,points:result.points});
}

test('CFI v2.1 replay is deterministic across 25 repeated runs',()=>{
  const rows=fixtures();
  const expected=fingerprint(strictPriorOnlineTournament(rows));
  for(let i=0;i<25;i++) assert.equal(fingerprint(strictPriorOnlineTournament(structuredClone(rows))),expected);
});

test('future result mutation cannot alter any earlier replay point',()=>{
  const rows=fixtures();
  const baseline=strictPriorOnlineTournament(rows);
  const changed=structuredClone(rows);
  const last=changed.at(-1);
  last.ht={home:9,away:9}; last.ft={home:12,away:11};
  const challenger=strictPriorOnlineTournament(changed);
  const cutoff=last.matchDate;
  assert.deepEqual(baseline.points.filter(x=>x.matchDate<cutoff),challenger.points.filter(x=>x.matchDate<cutoff));
});

test('promotion remains evidence gated for insufficient replay history',()=>{
  const result=strictPriorOnlineTournament(fixtures(60));
  assert.equal(result.promotion.eligible,false);
  assert.equal(result.promotion.reason,'INSUFFICIENT_OUT_OF_SAMPLE_REPLAY');
});

test('all learned market probabilities and weights remain finite and bounded',()=>{
  const result=strictPriorOnlineTournament(fixtures());
  for(const point of result.points){
    assert.ok(Number.isFinite(point.selectedWeightA));
    assert.ok(point.selectedWeightA>=0 && point.selectedWeightA<=1);
    if(Number.isFinite(point.probability)) assert.ok(point.probability>=0 && point.probability<=1);
  }
  for(const market of Object.values(result.markets)){
    if(market.brierBaseline!=null) assert.ok(market.brierBaseline>=0 && market.brierBaseline<=1);
    if(market.brierLearned!=null) assert.ok(market.brierLearned>=0 && market.brierLearned<=1);
  }
});
