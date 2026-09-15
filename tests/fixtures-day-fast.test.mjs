import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDayFixturesFast, handleFixturesDayRequest, parseBongdaWapSchedule } from '../src/runtime/fixtures-day-fast.ts';

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


test('BongdaWap HTML parser extracts upcoming fixtures and strips ranking labels', ()=>{
  const html=`
  <div class="tran1 " id="1">
    <div class="tengiai"><p><a>HQA</a></p></div>
    <div class="thongtin">
      <div class="ttgoc"><p class="ngaygio">14:30</p></div>
      <div class="doi1"><p class="tendb"><a>[11] Bucheon 1995</a></p></div>
      <div class="tttran"><p class="tyso"><a><b>vs</b></a></p></div>
      <div class="doi1 doi2"><p class="tendb"><a>Jeju Utd [5]</a></p></div>
    </div>
  </div>
  <div class="tran1 " id="2">
    <div class="tengiai"><p><a>ANHA</a></p></div>
    <div class="thongtin">
      <div class="ttgoc"><p class="ngaygio">21:00</p></div>
      <div class="doi1"><p class="tendb"><a>[6] Liverpool</a></p></div>
      <div class="tttran"><p class="tyso"><a href="soi-keo-liverpool-vs-fulham-12345.html"><b>vs</b></a></p></div>
      <div class="doi1 doi2"><p class="tendb"><a>Fulham [19]</a></p></div>
    </div>
  </div>`;
  const rows=parseBongdaWapSchedule(html,{
    targetDate:'2026-09-15',
    timeZone:'Asia/Ho_Chi_Minh',
    nowMs:Date.parse('2026-09-15T08:00:00Z')
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].home,'Liverpool');
  assert.equal(rows[0].away,'Fulham');
  assert.equal(rows[0].competition,'ANHA');
  assert.equal(rows[0].kickoffLocal,'21:00');
  assert.equal(rows[0].provider,'BONGDAWAP');
});

test('fast discovery accepts BongdaWap when JSON providers are blocked', async()=>{
  const html='<div class="tran1"><div class="tengiai"><a>ANHA</a></div><p class="ngaygio">21:00</p><p class="tendb"><a>[6] Liverpool</a></p><p class="tyso"><b>vs</b></p><p class="tendb"><a>Fulham [19]</a></p></div><div class="tran1"><div class="tengiai"><a>ITA</a></div><p class="ngaygio">22:30</p><p class="tendb"><a>Inter</a></p><p class="tyso"><b>vs</b></p><p class="tendb"><a>Milan</a></p></div>';
  const fakeFetch=async url=>{
    const u=String(url);
    if(u.includes('bongdawap.com'))return new Response(html,{status:200,headers:{'content-type':'text/html'}});
    return new Response('{}',{status:403,headers:{'content-type':'application/json'}});
  };
  const result=await discoverDayFixturesFast({
    targetDate:'2026-09-15',
    timeZone:'Asia/Ho_Chi_Minh',
    nowMs:Date.parse('2026-09-15T08:00:00Z')
  },fakeFetch);
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.providers,['BONGDAWAP']);
  assert.equal(result.provider,'BONGDAWAP');
});
