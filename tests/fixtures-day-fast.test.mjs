import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDayFixturesFast, handleFixturesDayRequest } from '../src/runtime/fixtures-day-fast.ts';

const NOW=Date.parse('2026-09-15T05:00:00Z');

function sofaPayload(){
  return {events:[
    {id:1,startTimestamp:(NOW+3600000)/1000,status:{type:'notstarted'},homeTeam:{name:'Alpha FC'},awayTeam:{name:'Beta FC'},tournament:{name:'League A',category:{country:{name:'X'}}}},
    {id:2,startTimestamp:(NOW+7200000)/1000,status:{type:'notstarted'},homeTeam:{name:'Gamma FC'},awayTeam:{name:'Delta FC'},tournament:{name:'League A',category:{country:{name:'X'}}}}
  ]};
}

function espnPayload(){
  return {events:[{
    id:'e1',
    date:new Date(NOW+10800000).toISOString(),
    status:{type:{state:'pre'}},
    name:'League B',
    competitions:[{competitors:[
      {homeAway:'home',team:{displayName:'Home ESPN'}},
      {homeAway:'away',team:{displayName:'Away ESPN'}}
    ]}]
  }]};
}

test('fixtures-day validates target date', async()=>{
  const r=await handleFixturesDayRequest(new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target_date:'bad'})
  }),async()=>{throw new Error('should not fetch')},NOW);
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'TARGET_DATE_INVALID');
});

test('fast daily discovery fans out providers and dedupes rows', async()=>{
  let calls=0;
  const fakeFetch=async url=>{
    calls++;
    const u=String(url);
    if(u.includes('sofascore.com')&&u.endsWith('/2026-09-15'))return Response.json(sofaPayload());
    if(u.includes('site.api.espn.com')&&u.includes('/eng.1/'))return Response.json(espnPayload());
    return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
  };
  const result=await discoverDayFixturesFast({
    targetDate:'2026-09-15',
    timeZone:'Asia/Ho_Chi_Minh',
    nowMs:NOW
  },fakeFetch);
  assert.ok(calls>30);
  assert.equal(result.rows.length,3);
  assert.deepEqual(result.providers.sort(),['ESPN','SOFASCORE']);
  assert.equal(result.provider,'MULTI_SOURCE');
  assert.equal(result.timeoutMs,3200);
});

test('fixtures-day HTTP response exposes rows without prediction side effects', async()=>{
  const fakeFetch=async url=>{
    const u=String(url);
    if(u.includes('sofascore.com')&&u.endsWith('/2026-09-15'))return Response.json(sofaPayload());
    return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
  };
  const r=await handleFixturesDayRequest(new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({target_date:'2026-09-15',timezone:'Asia/Ho_Chi_Minh'})
  }),fakeFetch,NOW);
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.status,'OK');
  assert.equal(body.action,'CFI_FIXTURES_DAY');
  assert.equal(body.counts.fixtures,2);
  assert.equal(body.rows[0].home,'Alpha FC');
  assert.equal(body.latencyPolicy.fanout,'parallel');
});
