import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeCanonicalFixtureRows, discoverFixtures, fixtureCohort, mergeDiscoveryRows, normalizeAiFixtureCandidates, parseSofascoreScheduled, parseTheSportsDbEvents, scorePrediction } from '../src/discovery/cfi-discovery.ts';
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

test('GPT search-first candidates become same-day sourced prematch fixtures without crawler calls',()=>{
  const nowMs=Date.parse('2026-08-26T08:00:00Z');
  const result=normalizeAiFixtureCandidates([
    {providerId:'official-1',home:'Alpha Women U19',away:'Beta Women U19',competition:'Women U19',kickoffIso:'2026-08-26T10:00:00Z',status:'scheduled',sourceUrls:['https://example.com/official-fixture'],discoveredAt:'2026-08-26T07:59:00Z'},
    {providerId:'wrong-day',home:'Tomorrow',away:'Match',kickoffIso:'2026-08-27T10:00:00Z',status:'scheduled',sourceUrls:['https://example.com/tomorrow'],discoveredAt:'2026-08-26T07:59:00Z'},
    {providerId:'no-source',home:'No',away:'Source',kickoffIso:'2026-08-26T11:00:00Z',status:'scheduled',sourceUrls:[],discoveredAt:'2026-08-26T07:59:00Z'},
  ],{targetDate:'2026-08-26',timeZone:'Asia/Ho_Chi_Minh',nowMs});
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].provider,'GPT_WEB_SEARCH');
  assert.equal(result.rows[0].kickoffLocal,'17:00');
  assert.equal(result.rows[0].discoveryMode,'GPT_SEARCH_FIRST');
  assert.deepEqual(result.rejected.map(row=>row.reason),['TARGET_DATE_MISMATCH','HTTPS_PROVENANCE_REQUIRED']);
});

test('GPT search-first candidates reject finished, past, malformed and unauditable inputs',()=>{
  const base={home:'Home',away:'Away',kickoffIso:'2026-08-26T10:00:00Z',sourceUrls:['https://example.com/fixture'],discoveredAt:'2026-08-26T07:00:00Z'};
  const result=normalizeAiFixtureCandidates([
    {...base,providerId:'finished',status:'finished'},
    {...base,providerId:'past',kickoffIso:'2026-08-26T06:00:00Z'},
    {...base,providerId:'bad-url',sourceUrls:['http://example.com/fixture']},
    {...base,providerId:'future-discovery',discoveredAt:'2026-08-26T09:00:00Z'},
  ],{targetDate:'2026-08-26',timeZone:'Asia/Ho_Chi_Minh',nowMs:Date.parse('2026-08-26T08:00:00Z')});
  assert.equal(result.rows.length,0);
  assert.deepEqual(result.rejected.map(row=>row.reason),['NOT_PREMATCH','KICKOFF_NOT_FUTURE','HTTPS_PROVENANCE_REQUIRED','FUTURE_DISCOVERY_TIMESTAMP']);
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
  const out=await discoverFixtures({targetDate,timeZone:'Asia/Ho_Chi_Minh',nowMs,minimumRows:2},fetchFn);
  assert.equal(out.provider,'MULTI_SOURCE');
  assert.deepEqual(out.providers.sort(),['ESPN','THESPORTSDB']);
  assert.equal(out.rows.length,2);
  assert.deepEqual(out.rows.map(r=>r.home).sort(),['Epsilon','Gamma']);
  // 6 Sofa date probes + 3 TheSportsDB day probes + 4 TheSportsDB league fallbacks + 6 ESPN league probes.
  assert.equal(out.attempts.length,19);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='SOFASCORE').length,6);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='THESPORTSDB').length,7);
  assert.equal(out.attempts.filter((a:any)=>a.provider==='ESPN').length,6);
  assert.equal(out.search.targetSatisfied,true);
  assert.equal(out.search.exhausted,false);
  assert.equal(out.attempts.some((a:any)=>a.url.includes('/soccer/all/')),false);
});

test('discovery keeps scanning real ESPN leagues until requested rows are found',async()=>{
  const targetDate='2026-08-23',nowMs=Date.parse('2026-08-23T05:00:00Z');
  const fetchFn:any=async(url:string)=>{
    if(!url.includes('site.api.espn.com'))return new Response(JSON.stringify({events:[]}),{status:200});
    const league=url.match(/soccer\/([^/]+)\/scoreboard/)?.[1];
    const events=league==='eng.4'?[{id:'21',date:'2026-08-23T11:00:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Academy U21'}},{homeAway:'away',team:{displayName:'Town Reserves'}}]}],name:'League Two'}]:[];
    return new Response(JSON.stringify({events}),{status:200});
  };
  const out=await discoverFixtures({targetDate,timeZone:'Asia/Ho_Chi_Minh',nowMs,minimumRows:1},fetchFn);
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].home,'Academy U21');
  assert.equal(out.search.targetSatisfied,true);
  assert.ok(out.search.espnLeaguesAttempted>6);
  assert.ok(out.search.espnLeaguesAttempted<out.search.espnLeagueCatalogSize);
});

test('discovery reports explicit exhaustion instead of silently accepting an undersized pool',async()=>{
  const fetchFn:any=async()=>new Response(JSON.stringify({events:[]}),{status:200});
  const out=await discoverFixtures({targetDate:'2026-08-23',timeZone:'Asia/Ho_Chi_Minh',nowMs:Date.parse('2026-08-23T05:00:00Z'),minimumRows:5},fetchFn);
  assert.equal(out.rows.length,0);
  assert.equal(out.search.targetSatisfied,false);
  assert.equal(out.search.exhausted,true);
  assert.equal(out.search.espnLeaguesAttempted,out.search.espnLeagueCatalogSize);
});

test('selection score fails closed without strict-prior verification',()=>{const r=scorePrediction({status:'SUCCESS',ranking:[{target:'3+ HT',probability:.8,confidence:'HIGH'}]});assert.equal(r.eligible,false);assert.equal(r.reason,'STRICT_PRIOR_NOT_VERIFIED');});

test('selection score is evidence aware rather than probability-only',()=>{
  const base={status:'SUCCESS',strictPrior:{verified:true},consistencyGuard:{status:'PASS'},scoreline:{uncertainty:'MEDIUM'},ranking:[{target:'3+ HT',probability:.65,confidence:'HIGH'}]};
  const weak=scorePrediction({...base,bigDbRetrieval:{exactTeam:{home:{retrieved:1},away:{retrieved:1},h2h:{retrieved:0}}}}),strong=scorePrediction({...base,bigDbRetrieval:{exactTeam:{home:{retrieved:50},away:{retrieved:50},h2h:{retrieved:8}}}});assert.equal(weak.eligible,true);assert.ok(strong.score>weak.score);
});

test('thin exact-team evidence remains visible but cannot qualify for practical decisions',()=>{
  const base={status:'SUCCESS',strictPrior:{verified:true},consistencyGuard:{status:'PASS'},scoreline:{uncertainty:'LOW'},ranking:[{target:'3+ HT',probability:.91,confidence:'HIGH'}],bigDbRetrieval:{exactTeam:{home:{retrieved:1},away:{retrieved:1},h2h:{retrieved:0}}}};
  const result=scorePrediction(base);
  assert.equal(result.eligible,true);
  assert.equal(result.evidenceSufficiency.status,'LIMITED');
  assert.equal(result.evidenceSufficiency.decisionEligible,false);
  assert.ok(result.score<80);
});

test('discovery never excludes women youth reserve or amateur cohorts',()=>{
  assert.equal(fixtureCohort({home:'Alpha Women U19',away:'Beta Women U19',competition:'Regional League'}).women,true);
  assert.equal(fixtureCohort({home:'Alpha Women U19',away:'Beta Women U19',competition:'Regional League'}).youth,true);
  assert.equal(fixtureCohort({home:'Town Reserves',away:'City II',competition:'State League'}).reserve,true);
  assert.equal(fixtureCohort({home:'Village',away:'County',competition:'Amateur Cup'}).amateur,true);
  const remote=[{providerId:'remote',home:'Senior A',away:'Senior B',targetDate:'2026-08-26'}];
  const publicRows=[{providerId:'women',home:'Alpha Women',away:'Beta Women',targetDate:'2026-08-26'},{providerId:'u19',home:'Academy U19',away:'Town U19',targetDate:'2026-08-26'}];
  assert.deepEqual(mergeDiscoveryRows([remote,publicRows],5).map(x=>x.providerId),['remote','women','u19']);
});

test('multi-market shadow remains decisionUse=false and coherent',()=>{const m=buildMultiMarketV1({htHome:.8,htAway:.5,ftHome:1.7,ftAway:1.1});assert.equal(m.decisionUse,false);assert.equal(m.consistencyGuard.status,'PASS');assert.ok(Math.abs(m.oneXTwo.ft.home+m.oneXTwo.ft.draw+m.oneXTwo.ft.away-1)<1e-9);});


test('canonical discovery rows are distinct before predictions execute',()=>{
  const rows=[
    {providerId:'a',home:'Vietnam',away:'Thailand',kickoffIso:'2026-08-26T10:00:00Z',canonicalHomeTeamId:'vn',canonicalAwayTeamId:'th'},
    {providerId:'b',home:'Viet Nam',away:'Thai Lan',kickoffIso:'2026-08-26T13:00:00Z',canonicalHomeTeamId:'vn',canonicalAwayTeamId:'th'},
    {providerId:'c',home:'Preston Lions',away:'South Melbourne',kickoffIso:'2026-08-26T10:30:00Z',canonicalHomeTeamId:'preston',canonicalAwayTeamId:'south-melbourne'},
  ];
  const distinct=dedupeCanonicalFixtureRows(rows);
  assert.equal(distinct.length,2);
  assert.deepEqual(distinct.map(r=>r.providerId),['a','c']);
});
