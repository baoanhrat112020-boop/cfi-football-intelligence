import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverDayFixturesFast,handleFixturesDayRequest} from '../src/runtime/fixtures-day-fast.ts';
const env={CFI_DB_BASE_URL:'https://db.example/cfi-db',CFI_DB_KEY:'test'};
const window={targetDate:'2026-09-15',timeZone:'Asia/Ho_Chi_Minh'};
const canonical={provider:'CFI_BIGDB',providerId:'db-1',home:'Alpha FC',away:'Beta FC',targetDate:window.targetDate,canonicalHomeTeamId:'h1',canonicalAwayTeamId:'a1',sourceProviders:['CFI_BIGDB','AISCORE'],provenance:'PERSISTENT_DB_CANONICAL_FIXTURE'};
const csv='Div,Date,Time,HomeTeam,AwayTeam\nE0,15/09/2026,10:00,Alpha FC,Beta FC\n';
const request=(extra={})=>new Request('https://cfi.test/api/fixtures-day',{method:'POST',body:JSON.stringify({target_date:window.targetDate,timezone:window.timeZone,...extra})});
function source(rows=[canonical],bad=false){
 let calls=0;
 const fetchFn=async url=>{
  calls++;
  if(String(url).includes('db.example'))return Response.json(bad?{status:'ERROR',rows:[]}:{status:'OK',version:'CFI_DB_FIXTURES_DAY_V2_AISCORE_BRIDGE',rows});
  return new Response(csv);
 };
 return {fetchFn,get calls(){return calls}};
}
test('same named web fixture enriches canonical row without losing bridge provenance',async()=>{
 const s=source();const out=await discoverDayFixturesFast(window,env,s.fetchFn);
 assert.equal(out.rows.length,1);
 assert.equal(out.rows[0].providerId,'db-1');
 assert.equal(out.rows[0].canonicalHomeTeamId,'h1');
 assert.equal(out.rows[0].kickoffLocal,'16:00');
 assert.deepEqual(new Set(out.rows[0].sourceProviders),new Set(['CFI_BIGDB','AISCORE','FOOTBALL_DATA']));
});
test('conflicting canonical IDs cannot be collapsed by matching names',async()=>{
 const s=source([canonical,{...canonical,providerId:'db-2',canonicalHomeTeamId:'h2'}]);
 const out=await discoverDayFixturesFast(window,env,s.fetchFn);
 assert.equal(out.rows.filter(r=>r.provider==='CFI_BIGDB').length,2);
 assert.equal(out.rows.length,3);
});
test('invalid calendar date and timezone return JSON 400 before fetching',async()=>{
 for(const input of [{target_date:'2026-02-30'},{timezone:'invalid/zone'}]){
  const s=source();const response=await handleFixturesDayRequest(request(input),env,s.fetchFn);
  assert.equal(response.status,400);assert.equal((await response.json()).status,'INVALID_REQUEST');
  assert.equal(s.calls,0);
 }
});
test('application-level BigDB errors never count as healthy primary',async()=>{
 const s=source([],true);const out=await discoverDayFixturesFast(window,env,s.fetchFn);
 assert.equal(out.attempts.find(x=>x.stage==='BIGDB').ok,false);
 assert.equal(out.rows.length,1);
});
test('simultaneous and recent browse requests share source work; expired cache refreshes',async()=>{
 const s=source();const now=Date.now();
 await Promise.all([handleFixturesDayRequest(request(),env,s.fetchFn,now),handleFixturesDayRequest(request(),env,s.fetchFn,now)]);
 assert.equal(s.calls,4);
 await handleFixturesDayRequest(request(),env,s.fetchFn,now+1000);
 assert.equal(s.calls,4);
 await handleFixturesDayRequest(request(),env,s.fetchFn,now+31000);
 assert.equal(s.calls,8);
});
test('degraded BigDB results are not retained in the browse cache',async()=>{
 const s=source([],true);const now=Date.now();
 await handleFixturesDayRequest(request(),env,s.fetchFn,now);
 await handleFixturesDayRequest(request(),env,s.fetchFn,now+1000);
  assert.equal(s.calls,8);
});

test('browse cache isolates database credentials',async()=>{
 const s=source();const now=Date.now();
 await handleFixturesDayRequest(request(),env,s.fetchFn,now);
 await handleFixturesDayRequest(request(),{...env,CFI_DB_KEY:'other'},s.fetchFn,now);
 assert.equal(s.calls,8);
});

test('HTML from BigDB is isolated and Football-Data still returns valid JSON',async()=>{
 const s=source();
 const fetchFn=async(url,init)=>String(url).includes('db.example')
   ? new Response('<html>upstream error</html>') : s.fetchFn(url,init);
 const response=await handleFixturesDayRequest(request(),env,fetchFn);
 const body=await response.json();
 assert.equal(body.rows.length,1);
 assert.equal(body.attempts.find(x=>x.stage==='BIGDB').ok,false);
});
