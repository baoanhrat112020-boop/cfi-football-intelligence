import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyMatchState } from '../cloudflare-worker/src/index-live-router.ts';

test('scheduled countdown states are classified as PREMATCH',()=>{
  for(const status of ['SCHEDULED','COUNTDOWN','NOT_STARTED','NS','PREMATCH','UPCOMING']){
    assert.equal(classifyMatchState({status}), 'PREMATCH', status);
  }
});

test('actual live period overrides stale countdown status',()=>{
  assert.equal(classifyMatchState({status:'COUNTDOWN',live:{period:'1H',minute:1,homeGoals:0,awayGoals:0}}),'LIVE');
  assert.equal(classifyMatchState({fixtureStatus:'SCHEDULED',live:{period:'2H',minute:60,homeGoals:1,awayGoals:0,htHomeGoals:0,htAwayGoals:0}}),'LIVE');
});

test('terminal states fail closed instead of becoming prematch',()=>{
  for(const status of ['FT','FINISHED','CANCELLED','POSTPONED','ABANDONED'])assert.equal(classifyMatchState({status}),'TERMINAL');
});

test('production router reroutes pre-kickoff live-endpoint requests to prematch without changing target date',()=>{
  const src=readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');
  for(const token of ["url.pathname='/api/predict'","target_date:String(input?.target_date??input?.matchDate??'').slice(0,10)","reason:'PRE_KICKOFF_COUNTDOWN_IS_PREMATCH'","requestedEndpoint:'/api/predict-live'","executedEndpoint:'/api/predict'"]){
    assert.ok(src.includes(token),token);
  }
});
