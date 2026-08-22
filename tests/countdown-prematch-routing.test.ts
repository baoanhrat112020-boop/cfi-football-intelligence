import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatchState, resolveTargetDate } from '../src/runtime/match-state-routing.ts';
import { routePreKickoffRequest } from '../src/runtime/pre-kickoff-routing.ts';

test('scheduled countdown states are classified as PREMATCH',()=>{
  for(const status of ['SCHEDULED','COUNTDOWN','NOT_STARTED','NS','PREMATCH','UPCOMING'])assert.equal(classifyMatchState({status}),'PREMATCH',status);
});

test('actual live period overrides stale countdown status',()=>{
  assert.equal(classifyMatchState({status:'COUNTDOWN',live:{period:'1H',minute:1,homeGoals:0,awayGoals:0}}),'LIVE');
  assert.equal(classifyMatchState({fixtureStatus:'SCHEDULED',live:{period:'2H',minute:60,homeGoals:1,awayGoals:0,htHomeGoals:0,htAwayGoals:0}}),'LIVE');
});

test('terminal states fail closed instead of becoming prematch',()=>{
  for(const status of ['FT','FINISHED','CANCELLED','POSTPONED','ABANDONED'])assert.equal(classifyMatchState({status}),'TERMINAL');
});

test('target date resolves only from explicit auditable request metadata',()=>{
  assert.deepEqual(resolveTargetDate({target_date:'2026-08-22'}),{date:'2026-08-22',source:'target_date'});
  assert.deepEqual(resolveTargetDate({kickoffAt:'2026-08-23T00:15:00+07:00'}),{date:'2026-08-23',source:'kickoffAt'});
  assert.deepEqual(resolveTargetDate({clientLocalDate:'2026-08-22'}),{date:'2026-08-22',source:'clientLocalDate'});
  assert.deepEqual(resolveTargetDate({}),{date:null,source:null});
});

test('COUNTDOWN sent to live endpoint is executed through prematch with resolved target date',async()=>{
  let seen:any=null;
  const fakePrematch=async(request:Request)=>{
    seen={url:new URL(request.url),body:await request.json()};
    return Response.json({status:'SUCCESS',runtime:{predictionPath:'NATIVE_V5_2_STRICT_PRIOR_BIGDB_V2_1_2'}});
  };
  const request=new Request('https://example.test/api/predict-live',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:'CSKA Moscow Reserves',away:'Lokomotiv Moscow Youth',status:'COUNTDOWN',clientLocalDate:'2026-08-22'})});
  const input=await request.clone().json();
  const response=await routePreKickoffRequest(request,input,fakePrematch,{},{});
  assert.ok(response);
  assert.equal(response!.status,200);
  assert.equal(seen.url.pathname,'/api/predict');
  assert.equal(seen.body.target_date,'2026-08-22');
  assert.equal(seen.body.home,'CSKA Moscow Reserves');
  const body:any=await response!.json();
  assert.equal(body.status,'SUCCESS');
  assert.equal(body.matchStateRouting.classifiedAs,'PREMATCH');
  assert.equal(body.matchStateRouting.requestedEndpoint,'/api/predict-live');
  assert.equal(body.matchStateRouting.executedEndpoint,'/api/predict');
  assert.equal(body.matchStateRouting.targetDateSource,'clientLocalDate');
});

test('COUNTDOWN without any auditable date source fails closed before prematch execution',async()=>{
  let called=false;
  const fakePrematch=async()=>{called=true;return Response.json({status:'SUCCESS'});};
  const request=new Request('https://example.test/api/predict-live',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({home:'A',away:'B',status:'COUNTDOWN'})});
  const input=await request.clone().json();
  const response=await routePreKickoffRequest(request,input,fakePrematch,{},{});
  assert.equal(called,false);
  assert.equal(response!.status,400);
  const body:any=await response!.json();
  assert.equal(body.error,'TARGET_DATE_REQUIRED');
  assert.equal(body.matchStateRouting.reason,'PRE_KICKOFF_TARGET_DATE_UNRESOLVED');
});

test('live state never enters pre-kickoff reroute helper',async()=>{
  const request=new Request('https://example.test/api/predict-live',{method:'POST'});
  const response=await routePreKickoffRequest(request,{status:'COUNTDOWN',live:{period:'1H',minute:1,homeGoals:0,awayGoals:0}},async()=>Response.json({}),{},{});
  assert.equal(response,null);
});
