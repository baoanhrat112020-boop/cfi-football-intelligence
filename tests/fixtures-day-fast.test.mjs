import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDayFixturesFast, handleFixturesDayRequest } from '../src/runtime/fixtures-day-fast.ts';

const targetDate='2026-09-15';
const timeZone='Asia/Ho_Chi_Minh';
const nowMs=Date.parse('2026-09-15T00:00:00Z');

function sofaPayload(count=50){
  const base=Date.parse('2026-09-15T12:00:00Z')/1000;
  return{
    events:Array.from({length:count},(_,i)=>({
      id:1000+i,
      homeTeam:{name:`Home ${i}`},
      awayTeam:{name:`Away ${i}`},
      startTimestamp:base+i*60,
      status:{type:'notstarted'},
      tournament:{name:'Test League',category:{country:{name:'Test'}}}
    }))
  };
}

test('fixtures-day validates target date', async()=>{
  const r=await handleFixturesDayRequest(new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({target_date:'bad'})
  }),async()=>{throw new Error('should not fetch')},nowMs);
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'TARGET_DATE_INVALID');
});

test('fast fixture discovery stops after broad primary source succeeds', async()=>{
  let calls=0,active=0,maxActive=0;
  const fetchFn=async()=>{
    calls++;active++;maxActive=Math.max(maxActive,active);
    await new Promise(r=>setTimeout(r,5));
    active--;
    return Response.json(sofaPayload(50));
  };
  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},fetchFn);
  assert.ok(out.rows.length>=40);
  assert.equal(calls,6);
  assert.ok(maxActive<=6);
  assert.equal(out.latencyMode,'PRIMARY_SOFA');
  assert.deepEqual(out.providers,['SOFASCORE']);
});

test('fast fixture discovery never exceeds six concurrent upstream requests', async()=>{
  let calls=0,active=0,maxActive=0;
  const fetchFn=async()=>{
    calls++;active++;maxActive=Math.max(maxActive,active);
    await new Promise(r=>setTimeout(r,10));
    active--;
    return Response.json({events:[]});
  };
  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},fetchFn);
  assert.equal(out.rows.length,0);
  assert.equal(calls,35);
  assert.ok(maxActive<=6);
  assert.equal(out.maxConcurrent,6);
  assert.equal(out.latencyMode,'STAGED_MULTI_SOURCE');
});

test('fixtures-day HTTP response exposes bounded latency policy', async()=>{
  const fetchFn=async()=>Response.json({events:[]});
  const request=new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({target_date:targetDate,timezone:timeZone})
  });
  const response=await handleFixturesDayRequest(request,fetchFn,nowMs);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,'OK');
  assert.equal(body.action,'CFI_FIXTURES_DAY');
  assert.equal(body.latencyPolicy.maxConcurrent,6);
  assert.equal(body.counts.targetRows,40);
});
