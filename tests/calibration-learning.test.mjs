import test from 'node:test';
import assert from 'node:assert/strict';
import { strictPriorOnlineTournament, CALIBRATION_LEARNER_VERSION } from '../src/prediction/calibration-learning.ts';

function fixtures(n=120){
  const out=[];
  for(let i=0;i<n;i++){
    const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
    const home=i%2===0?'Alpha':'Beta', away=i%2===0?'Beta':'Alpha';
    const h=i%7===0?3:(i%3===0?2:1), a=i%11===0?4:(i%4===0?2:0);
    out.push({id:String(i),matchDate:d,homeTeam:home,awayTeam:away,ht:{home:Math.min(h,2),away:Math.min(a,1)},ft:{home:h,away:a}});
  }
  return out;
}

test('online tournament is strict-prior and future-result invariant',()=>{
  const rows=fixtures();
  const first=strictPriorOnlineTournament(rows);
  const mutated=structuredClone(rows);
  mutated[mutated.length-1].ht={home:8,away:8}; mutated[mutated.length-1].ft={home:9,away:9};
  const second=strictPriorOnlineTournament(mutated);
  const cutoff=rows[rows.length-1].matchDate;
  assert.deepEqual(first.points.filter(x=>x.matchDate<cutoff),second.points.filter(x=>x.matchDate<cutoff));
  assert.equal(first.learner,CALIBRATION_LEARNER_VERSION);
  assert.equal(first.strictPrior,true);
});

test('candidate selection matures only from earlier pseudo-match losses',()=>{
  const result=strictPriorOnlineTournament(fixtures(140));
  const mature=result.points.filter(x=>x.selectionHistory>=20);
  assert.ok(mature.length>0);
  assert.ok(mature.every(x=>x.selectedWeightA>=0&&x.selectedWeightA<=1));
  assert.match(result.antiLeakage,/earlier pseudo-matches only/);
  for(const market of Object.values(result.markets)) assert.ok(market.eligible>0);
});

test('promotion cannot pass without 80 mature out-of-sample replays per market',()=>{
  const result=strictPriorOnlineTournament(fixtures(60));
  assert.equal(result.promotion.eligible,false);
  assert.equal(result.promotion.reason,'INSUFFICIENT_OUT_OF_SAMPLE_REPLAY');
});
