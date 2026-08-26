import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeCanonicalFixtureRows, discoverFixtures, parseSofascoreScheduled, parseTheSportsDbEvents, scorePrediction } from '../src/discovery/cfi-discovery.ts';
import { buildMultiMarketV1 } from '../src/prediction/multi-market-v1.ts';

test('Sofascore discovery keeps only future prematch fixtures in requested local window',()=>{
  const payload={events:[
    {id:1,startTimestamp:Date.parse('2026-08-23T08:00:00Z')/1000,status:{type:'notstarted'},homeTeam:{name:'Alpha'},awayTeam:{name:'Beta'},tournament:{name:'League A',category:{country:{name:'VN'}}}},
    {id:2,startTimestamp:Date.parse('2026-08-23T03:00:00Z')/1000,status:{type:'finished'},homeTeam:{name:'Done'},awayTeam:{name:'Game'},tournament:{name:'League B'}},
    {id:3,startTimestamp:Date.parse('2026-08-23T10:00:00Z')/1000,status:{type:'notstarted'},homeTeam:{name:'Late'},awayTeam:{name:'Game'},tournament:{name:'League C'}},
  ]};
  const rows=parseSofascoreScheduled(payload,{targetDate:'2026-08-23',timeZone:'Asia/Ho_Chi_Minh',startTime:'14:00',endTime:'16:00',nowMs:Date.parse('2026-08-23T05:00:00Z')});
  assert.equal(rows.length,1);assert.equal(rows[0].home,'Alpha');assert.equal(rows[0].kickoffLocal,'15:00');
});

test('TheSportsDB parser accepts future scheduled events and rejects finished events',()=>{
  const payload={events:[
    {idEvent:'10',strHomeTeam:'Gamma',strAwayTeam:'Delta',strLeague:'League X',strCountry:'Australia',strTimestamp:'2026-08-23T09:30:00Z',strStatus:'Not Started'},
    {idEvent:'11',strHomeTeam:'Old',strAwayTeam:'Game',strLeague:'League X',strTimestamp:'2026-08-23T08:00:00Z',strStatus:'Match Finished'},
  ]};
  const rows=parseTheSportsDbEvents(payload,{targetDate:'2026-08-23',timeZone:'Asia/Ho_Chi_Minh',startTime:'16:00',endTime:'17:00',nowMs:Date.parse('2026-08-23T05:00:00Z')});
  assert.equal(rows.length,1);assert.equal(rows[0].provider,'THESPORTSDB');assert.equal(rows[0].home,'Gamma');assert.equal(rows[0].kickoffLocal,'16:30');
});

test('discovery aggregates all usable providers across the timezone-spanning query dates',async()=>{
  const targetDate='2026-08-23',nowMs=Date.parse('2026-08-23T05:00:00Z');
  const fetchFn:any=async(url:string)=>{
    if(url.includes('sofascore.com'))return new Response(JSON.stringify({events:[]}),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('thesportsdb.com'))return new Response(JSON.stringify({events:[{idEvent:'10',strHomeTeam:'Gamma',strAwayTeam:'Delta',strLeague:'League X',strCountry:'Australia',strTimestamp:'2026-08-23T09:30:00Z',strStatus:'Not Started'}]}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({events:[{id:'20',date:'2026-08-23T10:00:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Epsilon'}},{homeAway:'away',team:{displayName:'Zeta'}}]}],name:'League Y'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const out=await discoverFixtures({targetDate,timeZone:'Asia/Ho_Chi_Minh',nowMs},fetchFn);
  assert.equal(out.provider,'MULTI_SOURCE');
  assert.deepEqual(out.providers.sort(),['ESPN','THESPORTSDB']);
  assert.equal(out.rows.length,2);
  assert.deepEqual(out.rows.map(r=>r.home).sort(),['Epsilon','Gamma']);
  assert.equal(out.attempts.length,12);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='SOFASCORE').length,6);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='THESPORTSDB').length,3);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='ESPN').length,3);
});

test('selection score fails closed without strict-prior verification',()=>{const r=scorePrediction({status:'SUCCESS',ranking:[{target:'3+ HT',probability:.8,confidence:'HIGH'}]});assert.equal(r.eligible,false);assert.equal(r.reason,'STRICT_PRIOR_NOT_VERIFIED');});

test('selection score is evidence aware rather than probability-only',()=>{
  const base={status:'SUCCESS',strictPrior:{verified:true},consistencyGuard:{status:'PASS'},scoreline:{uncertainty:'MEDIUM'},ranking:[{target:'3+ HT',probability:.65,confidence:'HIGH'}]};
  const weak=scorePrediction({...base,bigDbRetrieval:{exactTeam:{home:{retrieved:1},away:{retrieved:1},h2h:{retrieved:0}}}}),strong=scorePrediction({...base,bigDbRetrieval:{exactTeam:{home:{retrieved:50},away:{retrieved:50},h2h:{retrieved:8}}}});assert.equal(weak.eligible,true);assert.ok(strong.score>weak.score);
});

test('multi-market shadow remains decisionUse=false and coherent',()=>{const m=buildMultiMarketV1({htHome:.8,htAway:.5,ftHome:1.7,ftAway:1.1});assert.equal(m.decisionUse,false);assert.equal(m.consistencyGuard.status,'PASS');assert.ok(Math.abs(m.oneXTwo.ft.home+m.oneXTwo.ft.draw+m.oneXTwo.ft.away-1)<1e-9);});


test('canonical discovery rows are distinct before predictions execute',()=>{
  const rows=[
    {providerId:'a',home:'Vietnam',away:'Thailand',kickoffIso:'2026-08-26T10:00:00Z',canonicalHomeTeamId:'vn',canonicalAwayTeamId:'th'},
    {providerId:'b',home:'Viet Nam',away:'Thai Lan',kickoffIso:'2026-08-26T10:00:20Z',canonicalHomeTeamId:'vn',canonicalAwayTeamId:'th'},
    {providerId:'c',home:'Preston Lions',away:'South Melbourne',kickoffIso:'2026-08-26T10:30:00Z',canonicalHomeTeamId:'preston',canonicalAwayTeamId:'south-melbourne'},
  ];
  const distinct=dedupeCanonicalFixtureRows(rows);
  assert.equal(distinct.length,2);
  assert.deepEqual(distinct.map(r=>r.providerId),['a','c']);
});
