import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDayFixtures, handleMatchContext, resetIosApiRateLimitForTest } from '../src/runtime/ios-api-routes.ts';
import {
  buildMatchContextPayload,
  bigDbContextHttpStatus,
  normalizeMatchContextFixture,
  localDateInTimeZone,
  strictPriorRetrievalCutoff,
  verifyMatchContextTemporalAudit
} from '../src/runtime/match-context.ts';

test('match-context payload is read-only, strict-prior and sanitizes BigDB rows', () => {
  const big = {
    status: 'OK',
    identity: {
      homeCanonical: 'Home FC',
      awayCanonical: 'Away FC',
      homeTeamId: 'h1',
      awayTeamId: 'a1'
    },
    temporalAudit: {
      verified: true,
      targetDate: '2026-09-15',
      maxEvidenceDate: '2026-09-10',
      futureEvidenceCount: 0,
      sameDateEvidenceCount: 0
    },
    exactTeam: {
      home: { retrieved: 2 },
      away: { retrieved: 2 },
      h2h: { retrieved: 1 }
    },
    fixtures: {
      home: [
        { fixture_id:'1', match_date:'2026-09-10', home_name:'Home FC', away_name:'Rival A', ht_home:1, ht_away:0, ft_home:2, ft_away:0, competition_name:'L1' },
        { fixture_id:'2', match_date:'2026-09-05', home_name:'Rival B', away_name:'Home FC', ht_home:0, ht_away:1, ft_home:1, ft_away:1, competition_name:'L1' }
      ],
      away: [
        { fixture_id:'3', match_date:'2026-09-09', home_name:'Away FC', away_name:'Rival C', ht_home:0, ht_away:0, ft_home:0, ft_away:1, competition_name:'L2' },
        { fixture_id:'4', match_date:'2026-09-03', home_name:'Rival D', away_name:'Away FC', ht_home:1, ht_away:1, ft_home:2, ft_away:3, competition_name:'L2' }
      ],
      h2h: [
        { fixture_id:'5', match_date:'2026-08-01', home_name:'Home FC', away_name:'Away FC', ht_home:0, ht_away:0, ft_home:1, ft_away:0, competition_name:'Cup', provenance:[{secret:'must not leak'}] }
      ]
    }
  };

  const body = buildMatchContextPayload(big, 'Home FC', 'Away FC', '2026-09-15');
  assert.equal(body.status, 'OK');
  assert.equal(body.readOnly, true);
  assert.equal(body.strictPrior, true);
  assert.equal(body.temporalAudit.verified, true);
  assert.deepEqual(body.home.form, ['W','D']);
  assert.deepEqual(body.away.form, ['L','W']);
  assert.equal(body.home.avgGoalsFor, 1.5);
  assert.equal(body.away.avgGoalsFor, 1.5);
  assert.equal(body.h2h.fixtures, 1);
  assert.equal(body.h2h.recent[0].matchDate, '2026-08-01');
  assert.equal('provenance' in body.h2h.recent[0], false);
});

test('context fixture normalization excludes raw provenance and preserves scores', () => {
  const row = normalizeMatchContextFixture({
    fixture_id:'x',
    match_date:'2026-08-01',
    home_name:'A',
    away_name:'B',
    ht_home:1,
    ht_away:0,
    ft_home:3,
    ft_away:2,
    provenance:[{secret:'no'}]
  });
  assert.deepEqual(row?.ht, {home:1,away:0});
  assert.deepEqual(row?.ft, {home:3,away:2});
  assert.equal(row && 'provenance' in row, false);
});

test('upstream 402 maps to service unavailable for match-context', () => {
  assert.equal(bigDbContextHttpStatus(402), 503);
  assert.equal(bigDbContextHttpStatus(500), 502);
});


test('future match context cutoff never advances beyond current local date', () => {
  const now=Date.parse('2026-09-15T06:00:00Z'); // 13:00 Asia/Ho_Chi_Minh
  assert.equal(localDateInTimeZone(now,'Asia/Ho_Chi_Minh'),'2026-09-15');
  assert.equal(strictPriorRetrievalCutoff('2026-09-20',now,'Asia/Ho_Chi_Minh'),'2026-09-15');
  assert.equal(strictPriorRetrievalCutoff('2026-09-10',now,'Asia/Ho_Chi_Minh'),'2026-09-10');
});

test('match context temporal audit fails closed on leakage', () => {
  const ok=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-14',futureEvidenceCount:0,sameDateEvidenceCount:0},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(ok.verified,true);

  const future=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-16',futureEvidenceCount:0,sameDateEvidenceCount:0},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(future.verified,false);

  const sameDateLeak=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-14',futureEvidenceCount:0,sameDateEvidenceCount:1},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(sameDateLeak.verified,false);
});


const NOW=Date.parse('2026-09-15T06:00:00Z');
const env={CFI_DB_BASE_URL:'https://db.example/functions/v1/cfi-db',CFI_DB_KEY:'secret'};
const req=(path,body,headers={})=>new Request('https://cfi.local'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

function bigDbOk(){
  return{
    status:'OK',
    identity:{homeCanonical:'Home FC',awayCanonical:'Away FC'},
    temporalAudit:{verified:true,maxEvidenceDate:'2026-09-14',futureEvidenceCount:0,sameDateEvidenceCount:0},
    fixtures:{home:[],away:[],h2h:[]},
    exactTeam:{home:{retrieved:0},away:{retrieved:0},h2h:{retrieved:0}}
  };
}

test('HTTP match-context validates config and request', async () => {
  resetIosApiRateLimitForTest();
  let r=await handleMatchContext(req('/api/match-context',{home:'A',away:'B',target_date:'2026-09-20'}),{}, {nowMs:NOW});
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'BIGDB_CONTEXT_UNAVAILABLE');

  resetIosApiRateLimitForTest();
  r=await handleMatchContext(req('/api/match-context',{home:'',away:'B',target_date:'2026-09-20'}),env,{nowMs:NOW});
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'HOME_AWAY_REQUIRED');
});

test('HTTP match-context uses strict-prior cutoff and returns sanitized context', async () => {
  resetIosApiRateLimitForTest();
  const fakeFetch=async (_url,init)=>{
    const body=JSON.parse(init.body);
    assert.deepEqual(body,{home:'Home FC',away:'Away FC',target_date:'2026-09-15'});
    assert.equal(init.headers['x-cfi-key'],'secret');
    return Response.json(bigDbOk());
  };
  const r=await handleMatchContext(
    req('/api/match-context',{home:'Home FC',away:'Away FC',target_date:'2026-09-20'},{'cf-connecting-ip':'1.2.3.4'}),
    env,{nowMs:NOW,fetchFn:fakeFetch}
  );
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.status,'OK');
  assert.equal(body.target.date,'2026-09-20');
  assert.equal(body.retrievalCutoffDate,'2026-09-15');
  assert.equal(body.temporalAudit.verified,true);
  assert.equal(body.readOnly,true);
});

test('HTTP match-context rate limit fails closed', async () => {
  resetIosApiRateLimitForTest();
  const fakeFetch=async()=>Response.json(bigDbOk());
  let last;
  for(let i=0;i<19;i++){
    last=await handleMatchContext(
      req('/api/match-context',{home:'Home FC',away:'Away FC',target_date:'2026-09-20'},{'cf-connecting-ip':'9.9.9.9'}),
      env,{nowMs:NOW,fetchFn:fakeFetch}
    );
  }
  assert.equal(last.status,429);
  assert.equal(last.headers.get('retry-after'),'60');
  assert.equal((await last.json()).error,'MATCH_CONTEXT_RATE_LIMIT');
});

test('HTTP fixtures-day validates and exposes discovery result only', async () => {
  let r=await handleDayFixtures(req('/api/fixtures-day',{target_date:'bad'}),{nowMs:NOW});
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'TARGET_DATE_INVALID');

  const rows=[{provider:'ESPN',providerId:'1',home:'A',away:'B',competition:'L',country:null,kickoff:NOW+3600000,kickoffIso:new Date(NOW+3600000).toISOString(),kickoffLocal:'14:00',targetDate:'2026-09-15',status:'pre'}];
  const discoverFn=async window=>{
    assert.equal(window.minimumRows,100);
    assert.equal(window.targetDate,'2026-09-15');
    return{provider:'ESPN',providers:['ESPN'],rows,attempts:[{provider:'ESPN',ok:true,rows:1}],sourceUrl:null,search:{requestedRows:100,foundRows:1,targetSatisfied:false,espnLeaguesAttempted:1,espnLeagueCatalogSize:1,exhausted:true}};
  };
  r=await handleDayFixtures(req('/api/fixtures-day',{target_date:'2026-09-15',timezone:'Asia/Ho_Chi_Minh'}),{nowMs:NOW,discoverFn});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.status,'OK');
  assert.equal(body.counts.fixtures,1);
  assert.equal(body.rows[0].home,'A');
});
