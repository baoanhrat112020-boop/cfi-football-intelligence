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

const bigDbPayload=(count=13)=>({
  status:'OK',
  rows:Array.from({length:count},(_,i)=>({
    provider:'CFI_BIGDB',
    providerId:`db-${i}`,
    home:`Home ${i}`,
    away:`Away ${i}`,
    competition:'Canonical League',
    targetDate,
    canonicalHomeTeamId:`h-${i}`,
    canonicalAwayTeamId:`a-${i}`,
    status:'CANONICAL'
  }))
});

const footballCsv=`Div,Date,Time,HomeTeam,AwayTeam
EC,15/09/2026,19:45,Boreham Wood,Boston Utd
SP1,15/09/2026,20:00,Valencia,Betis
SP1,16/09/2026,20:00,Real Madrid,Sociedad
`;

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

test('BigDB and Football-Data are the primary daily sources', async()=>{
  const calls=[];
  const fetchFn=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).includes('/cfi-db/fixtures-day')){
      assert.equal(init.headers['x-cfi-key'],'secret');
      return Response.json(bigDbPayload(13));
    }
    if(String(url).includes('football-data.co.uk/fixtures.csv')){
      return new Response(footballCsv,{status:200,headers:{'content-type':'text/csv'}});
    }
    throw new Error('unexpected fallback fetch '+url);
  };

  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},env,fetchFn);
  assert.equal(calls.length,2);
  assert.ok(out.rows.length>=15);
  assert.deepEqual(out.primarySources,['CFI_BIGDB','FOOTBALL_DATA']);
  assert.equal(out.attempts.find(x=>x.provider==='CFI_BIGDB').rows,13);
  assert.equal(out.attempts.find(x=>x.provider==='FOOTBALL_DATA').rows,2);
  assert.ok(out.providers.includes('CFI_BIGDB'));
  assert.ok(out.providers.includes('FOOTBALL_DATA'));
});

test('fallback is used only when primary coverage is below target', async()=>{
  const html=`
    <table>
      <tr><td>HQA</td><td>14:30</td><td>-</td><td>[11] Bucheon 1995</td><td>vs</td><td>Jeju Utd [5]</td><td></td><td>-</td></tr>
    </table>`;
  let fallbackCalls=0;
  const fetchFn=async(url)=>{
    const s=String(url);
    if(s.includes('/cfi-db/fixtures-day'))return Response.json(bigDbPayload(1));
    if(s.includes('football-data.co.uk/fixtures.csv'))return new Response('Div,Date,Time,HomeTeam,AwayTeam\n',{status:200});
    if(s.includes('bongdawap.com')){fallbackCalls++;return new Response(html,{status:200});}
    throw new Error('unexpected '+url);
  };
  const out=await discoverDayFixturesFast({targetDate,timeZone,nowMs},env,fetchFn);
  assert.equal(fallbackCalls,1);
  assert.ok(out.rows.some(x=>x.provider==='BONGDAWAP'));
});

test('fixtures-day HTTP response exposes source policy', async()=>{
  const fetchFn=async(url)=>{
    const s=String(url);
    if(s.includes('/cfi-db/fixtures-day'))return Response.json(bigDbPayload(13));
    if(s.includes('football-data.co.uk/fixtures.csv'))return new Response(footballCsv,{status:200});
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
  assert.equal(body.version,'CFI_FIXTURES_DAY_V2_BIGDB_FOOTBALLDATA');
  assert.equal(body.sourcePolicy.primary[0],'CFI_BIGDB');
  assert.equal(body.sourcePolicy.primary[1],'FOOTBALL_DATA');
  assert.ok(body.counts.fixtures>=15);
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
