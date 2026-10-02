import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverDayFixturesFast,
  handleFixturesDayRequest,
  parseBongdaWapSchedule,
  parseFootballDataFixturesCsv
} from '../src/runtime/fixtures-day-fast.ts';

const targetDate='2026-09-15';
const timeZone='Asia/Ho_Chi_Minh';
const nowMs=Date.parse('2026-09-15T00:00:00Z');
const env={CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'secret'};

const bigDbPayload=(count=13,withAiBridge=false)=>{
  const rows=Array.from({length:count},(_,i)=>({
    provider:'CFI_BIGDB',
    providerId:`db-${i}`,
    home:`Home ${i}`,
    away:`Away ${i}`,
    competition:'Canonical League',
    targetDate,
    canonicalHomeTeamId:`h-${i}`,
    canonicalAwayTeamId:`a-${i}`,
    status:'CANONICAL',
    sourceProviders:['CFI_BIGDB']
  }));
  if(withAiBridge)rows.push({
    provider:'AISCORE',
    providerId:'aiscore-live-1',
    home:'Ai Home',
    away:'Ai Away',
    competition:'Ai League',
    targetDate,
    kickoffIso:'2026-09-15T13:00:00.000Z',
    kickoffLocal:'20:00',
    status:'scheduled',
    provenance:'PC_NODE_AISCORE_BRIDGE',
    sourceProviders:['AISCORE']
  });
  return{status:'OK',version:'CFI_DB_FIXTURES_DAY_V2_AISCORE_BRIDGE',rows};
};

const footballCsv=`Div,Date,Time,HomeTeam,AwayTeam
EC,15/09/2026,19:45,Boreham Wood,Boston Utd
SP1,15/09/2026,20:00,Valencia,Betis
SP1,16/09/2026,20:00,Real Madrid,Sociedad
`;

const coverageHtml=`
  <table>
    <tr><td>HQA</td><td>14:30</td><td>-</td><td>[11] Bucheon 1995</td><td>vs</td><td>Jeju Utd [5]</td><td></td><td>-</td></tr>
    <tr><td>ENG</td><td>20:00</td><td>-</td><td>Alpha FC</td><td>vs</td><td>Beta FC</td><td></td><td>-</td></tr>
  </table>`;

test('fixtures-day validates target date', async()=>{
  const r=await handleFixturesDayRequest(new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({target_date:'bad'})
  }),env,async()=>{throw new Error('should not fetch')},nowMs);
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'TARGET_DATE_INVALID');
});

test('Football-Data parser keeps target date and normalizes known kickoff timezone', ()=>{
  const rows=parseFootballDataFixturesCsv(footballCsv,{targetDate,timeZone,nowMs});
  assert.equal(rows.length,2);
  assert.equal(rows[0].provider,'FOOTBALL_DATA');
  assert.equal(rows[0].targetDate,targetDate);
  assert.ok(rows[0].kickoffIso);
  assert.match(rows[0].kickoffLocal,/^\d{2}:\d{2}$/);
});

test('daily discovery merges BigDB, AiScore bridge and Football-Data in parallel without BongdaWap', async()=>{
  const calls=[];
  const fetchFn=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).includes('/cfi-db/fixtures-day')){
      assert.equal(init.headers['x-cfi-key'],'secret');
      return Response.json(bigDbPayload(13,true));
    }
    if(String(url).includes('football-data.co.uk/fixtures.csv')){
      return new Response(footballCsv,{status:200,headers:{'content-type':'text/csv'}});
    }
    if(String(url).includes('bongdawap.com')){
      return new Response(coverageHtml,{status:200,headers:{'content-type':'text/html'}});
    }
    throw new Error('unexpected fixture fetch '+url);
  };

  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},env,fetchFn);
  assert.equal(calls.length,2);
  assert.ok(!calls.some(u=>u.includes('bongdawap.com')));
  assert.ok(out.rows.length>=16);
  assert.deepEqual(out.primarySources,['CFI_BIGDB_WITH_AISCORE_PC_BRIDGE','FOOTBALL_DATA']);
  assert.deepEqual(out.coverageSources,[]);
  assert.equal(out.latencyMode,'PARALLEL_ALL_DAY_MULTI_SOURCE');
  assert.equal(out.attempts.find(x=>x.provider==='CFI_BIGDB').rows,14);
  assert.equal(out.attempts.find(x=>x.provider==='FOOTBALL_DATA').rows,2);
  assert.equal(out.attempts.find(x=>x.provider==='BONGDAWAP'),undefined);
  assert.ok(out.providers.includes('CFI_BIGDB'));
  assert.ok(out.providers.includes('AISCORE'));
  assert.ok(out.providers.includes('FOOTBALL_DATA'));
  assert.ok(!out.providers.includes('BONGDAWAP'));
  const ai=out.rows.find(x=>x.provider==='AISCORE');
  assert.ok(ai);
  assert.equal(ai.kickoffLocal,'20:00');
  assert.equal(ai.provenance,'PC_NODE_AISCORE_BRIDGE');
});

test('BongdaWap coverage feed is no longer queried even when BigDB already exceeds the old minimum', async()=>{
  let coverageCalls=0;
  const fetchFn=async(url)=>{
    const s=String(url);
    if(s.includes('/cfi-db/fixtures-day'))return Response.json(bigDbPayload(13,true));
    if(s.includes('football-data.co.uk/fixtures.csv'))return new Response(footballCsv,{status:200});
    if(s.includes('bongdawap.com')){
      coverageCalls++;
      return new Response(coverageHtml,{status:200});
    }
    throw new Error('unexpected '+url);
  };

  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},env,fetchFn);

  assert.equal(coverageCalls,0);
  assert.ok(!out.rows.some(x=>x.provider==='BONGDAWAP'));
  assert.ok(out.rows.length>=16);
});

test('fixtures-day HTTP response exposes source policy', async()=>{
  const fetchFn=async(url)=>{
    const s=String(url);
    if(s.includes('/cfi-db/fixtures-day'))return Response.json(bigDbPayload(13,true));
    if(s.includes('football-data.co.uk/fixtures.csv'))return new Response(footballCsv,{status:200});
    if(s.includes('bongdawap.com'))return new Response(coverageHtml,{status:200});
    throw new Error('unexpected '+url);
  };
  const request=new Request('https://cfi.local/api/fixtures-day',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({target_date:targetDate,timezone:timeZone})
  });
  const response=await handleFixturesDayRequest(request,env,fetchFn,nowMs);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,'OK');
  assert.equal(body.version,'CFI_FIXTURES_DAY_V11_NO_BONGDAWAP');
  assert.equal(body.sourcePolicy.primary[0],'CFI_BIGDB_WITH_AISCORE_PC_BRIDGE');
  assert.equal(body.sourcePolicy.primary[1],'FOOTBALL_DATA');
  assert.deepEqual(body.sourcePolicy.coverage,[]);
  assert.equal(body.sourcePolicy.mode,'PARALLEL_ALL_DAY_MULTI_SOURCE');
  assert.equal(body.counts.targetRows,20);
  assert.equal(body.counts.fixtures,1);
  assert.equal(body.counts.filteredToday,true);
  assert.ok(!body.rows.some(x=>x.provider==='CFI_BIGDB'&&!x.kickoffIso));
  assert.ok(body.rows.some(x=>x.provider==='AISCORE'));
});

test('BongdaWap all-day parser keeps scheduled and completed rows', ()=>{
  const html=`
    <table>
      <tr><td>HQA</td><td>14:30</td><td>-</td><td>[11] Bucheon 1995</td><td>vs</td><td>Jeju Utd [5]</td><td></td><td>-</td></tr>
      <tr><td>ENG</td><td>20:00</td><td>-</td><td>Alpha FC</td><td>2 - 1</td><td>Beta FC</td><td></td><td>1-0</td></tr>
    </table>`;
  const rows=parseBongdaWapSchedule(html,{targetDate,timeZone,nowMs});
  assert.equal(rows.length,2);
  assert.equal(rows[0].home,'Bucheon 1995');
  assert.equal(rows[0].away,'Jeju Utd');
  assert.equal(rows[0].status,'scheduled');
  assert.equal(rows[1].status,'finished');
});
