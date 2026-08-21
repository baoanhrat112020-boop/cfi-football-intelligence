import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshots,validateNoFutureLeakage } from '../research/live-historical-snapshot-builder.mjs';

const shot=(minute,second,team,outcome,xg,index)=>({period:minute<46?1:2,minute,second,index,team:{name:team},type:{name:'Shot'},shot:{outcome:{name:outcome},statsbomb_xg:xg}});
const sub=(minute,team,index)=>({period:minute<46?1:2,minute,second:0,index,team:{name:team},type:{name:'Substitution'}});
const events=[shot(10,0,'Home','Goal',.3,1),shot(14,59,'Away','Saved',.2,2),shot(15,1,'Away','Goal',.4,3),sub(58,'Home',4),shot(61,0,'Home','Goal',.5,5),shot(80,0,'Away','Goal',.6,6)];

test('builds 15/30/45/60/75 strict-prefix snapshots without future leakage',()=>{
 const rows=buildSnapshots({matchId:1,homeTeam:'Home',awayTeam:'Away',events});
 assert.deepEqual(rows.map(x=>x.minute),[15,30,45,60,75]);
 assert.deepEqual(rows[0].score,{home:1,away:0});
 assert.equal(rows[0].shotsOnTarget.away,1);
 assert.equal(rows[0].provenance.futureEventsIncluded,false);
 assert.equal(rows[3].substitutions.home,1);
 assert.deepEqual(rows[4].score,{home:2,away:1});
 for(const r of rows) assert.equal(validateNoFutureLeakage(r,events),true);
});

test('labels are derived from full outcome but never included in feature prefix',()=>{
 const rows=buildSnapshots({matchId:1,homeTeam:'Home',awayTeam:'Away',events});
 assert.deepEqual(rows[0].labels.ftScore,{home:2,away:2});
 assert.deepEqual(rows[0].labels.remainingGoals,{home:1,away:2});
 assert.equal(rows[0].provenance.eventPrefixCount,2);
});
