import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshots } from '../research/live-historical-snapshot-builder.mjs';
import { selectStrictPrematchPrior } from '../research/live-prematch-prior-bridge.mjs';
import { evaluateDualReplay } from '../research/live-dual-replay-v1-v1_1.mjs';
import { evaluateLiveCandidate } from '../research/live-self-learning-v1.mjs';

const shot=(minute,team,outcome,xg,index,period=minute<46?1:2)=>({period,minute,second:0,index,team:{name:team},type:{name:'Shot'},shot:{outcome:{name:outcome},statsbomb_xg:xg}});
const events=[shot(10,'Home','Goal',.30,1),shot(20,'Away','Saved',.25,2),shot(44,'Home','Goal',.35,3),shot(46,'Away','Goal',.40,4,2),shot(70,'Home','Goal',.50,5,2)];
const fixture={fixture_id:'fx-1',match_date:'2026-01-10',target_date:'2026-01-10',kickoff_at:'2026-01-10T15:00:00Z',competition_name:'League A',country:'Country A'};
const validPrior={strict_prior:true,status:'SUCCESS',target_date:'2026-01-10',created_at:'2026-01-10T14:00:00Z',max_evidence_date:'2026-01-09',model_version:'CFI_FINAL_V5.2.5',prediction:{engine:'CFI_FINAL_V5.2.5',scoreline:{expectedGoals:{ftHome:1.8,ftAway:1.2}}}};

test('parallel LIVE research E2E keeps prior bridge fail-closed and produces replay artifact',()=>{
 const bad={...validPrior,created_at:'2026-01-10T15:01:00Z'};
 assert.equal(selectStrictPrematchPrior(fixture,[bad]).status,'EXCLUDE_NO_STRICT_PRIOR');
 const selected=selectStrictPrematchPrior(fixture,[bad,validPrior]);
 assert.equal(selected.status,'OK');
 const snapshots=buildSnapshots({matchId:'fx-1',homeTeam:'Home',awayTeam:'Away',events});
 assert.deepEqual(snapshots[3].halftimeScore,{home:2,away:0});
 const records=snapshots.map(snapshot=>({fixture,snapshot,priorSnapshot:selected.snapshot}));
 const replay=evaluateDualReplay(records);
 assert.equal(replay.status,'OK');
 assert.equal(replay.candidate.meta.strictPrior,true);
 assert.equal(replay.candidate.meta.deterministic,true);
 assert.deepEqual(replay.candidate.meta.snapshotMinutes,[15,30,45,60,75]);
 assert.equal(replay.candidate.meta.samples,5);
 const gate=evaluateLiveCandidate(replay.candidate);
 assert.equal(gate.decision,'HOLD');
 assert.ok(gate.reasons.includes('INSUFFICIENT_SAMPLE'));
});

test('snapshot labels include settled HT and FT targets without exposing HT score before halftime',()=>{
 const rows=buildSnapshots({matchId:'fx-1',homeTeam:'Home',awayTeam:'Away',events});
 assert.equal(rows[0].halftimeScore,null);
 assert.deepEqual(rows[0].labels.htScore,{home:2,away:0});
 assert.equal(rows[0].labels.threePlusHT,0);
 assert.equal(rows[0].labels.otherHT,0);
 assert.deepEqual(rows[4].labels.ftScore,{home:3,away:1});
});
