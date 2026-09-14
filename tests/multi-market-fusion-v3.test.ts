import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMultiMarketFusionV3,
  getMultiMarketFusionV3ResearchState,
  normalizeBigDbScorelinePrior,
} from '../src/prediction/multi-market-fusion-v3.ts';

const grid=(rows:Array<[string,number]>)=>rows.map(([score,probability])=>({score,probability}));

const htInc=grid([
  ['0-0',.25],['1-0',.22],['0-1',.16],['1-1',.18],['2-0',.08],['0-2',.05],['2-1',.04],['1-2',.02],
]);
const htFuture=grid([
  ['0-0',.22],['1-0',.20],['0-1',.15],['1-1',.18],['2-0',.10],['0-2',.06],['2-1',.06],['1-2',.03],
]);
const htHistorical=grid([
  ['0-0',.28],['1-0',.20],['0-1',.18],['1-1',.17],['2-0',.07],['0-2',.04],['2-1',.04],['1-2',.02],
]);

const ftInc=grid([
  ['0-0',.07],['1-0',.13],['0-1',.10],['1-1',.15],['2-0',.09],['0-2',.07],['2-1',.12],['1-2',.09],
  ['2-2',.06],['3-1',.05],['1-3',.03],['3-2',.02],['2-3',.01],['4-1',.005],['1-4',.005],
]);
const ftFuture=grid([
  ['0-0',.05],['1-0',.12],['0-1',.09],['1-1',.14],['2-0',.10],['0-2',.07],['2-1',.13],['1-2',.10],
  ['2-2',.07],['3-1',.055],['1-3',.035],['3-2',.025],['2-3',.015],['4-1',.0075],['1-4',.0075],
]);
const ftHistorical=grid([
  ['0-0',.08],['1-0',.14],['0-1',.11],['1-1',.16],['2-0',.08],['0-2',.06],['2-1',.11],['1-2',.08],
  ['2-2',.055],['3-1',.045],['1-3',.025],['3-2',.015],['2-3',.01],['4-1',.0025],['1-4',.0025],
]);

const bigDb={
  version:'CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE',
  temporalAudit:{
    targetDate:'2026-09-20',
    maxEvidenceDate:'2026-09-19',
    futureEvidenceCount:0,
    sameDateEvidenceCount:0,
    verified:true,
  },
  globalPrior:{fixtureCount:74926,markets:{}},
  exactTeam:{home:{retrieved:45,bigDbOnly:20,overlap:10},away:{retrieved:42,bigDbOnly:18,overlap:8},h2h:{retrieved:6,bigDbOnly:2,overlap:2}},
  globalScorelinePrior:{
    ht:grid([['0-0',.30],['1-0',.20],['0-1',.18],['1-1',.17],['2-0',.06],['0-2',.04],['2-1',.03],['1-2',.02]]),
    ft:grid([['0-0',.08],['1-0',.14],['0-1',.11],['1-1',.16],['2-0',.09],['0-2',.07],['2-1',.11],['1-2',.08],['2-2',.06],['3-1',.04],['1-3',.025],['3-2',.02],['2-3',.01],['4-1',.0025],['1-4',.0025]]),
  },
};

function build(reverse=false,override:any={}){
  const htExperts=[
    {name:'INCUMBENT_FINAL',grid:htInc,effectiveSampleSize:42,reliability:.95},
    {name:'FUTURE_SIX',grid:htFuture,effectiveSampleSize:42,reliability:.88},
    {name:'HISTORICAL',grid:htHistorical,effectiveSampleSize:120,reliability:.90},
  ];
  const ftExperts=[
    {name:'INCUMBENT_FINAL',grid:ftInc,effectiveSampleSize:42,reliability:.95},
    {name:'FUTURE_SIX',grid:ftFuture,effectiveSampleSize:42,reliability:.88},
    {name:'HISTORICAL',grid:ftHistorical,effectiveSampleSize:120,reliability:.90},
  ];
  return buildMultiMarketFusionV3({
    targetDate:'2026-09-20',
    maxEvidenceDate:'2026-09-19',
    evidenceCount:42,
    h2hCount:6,
    htExperts:reverse?[...htExperts].reverse():htExperts,
    ftExperts:reverse?[...ftExperts].reverse():ftExperts,
    bigDb,
    maxTrajectoryFtProjectionTv:.35,
    ...override,
  });
}

test('Fusion V3 uses strict-prior BigDB and remains research-only',()=>{
  const out=build();
  assert.equal(out.status,'SHADOW_READY');
  assert.equal(out.mode,'SHADOW_RESEARCH');
  assert.equal(out.decisionUse,false);
  assert.equal(out.productionEligible,false);
  assert.equal(out.bigDb.used,true);
  assert.equal(out.strictPrior.verified,true);
  assert.equal(out.coherence.status,'PASS');
  assert.equal(out.coherence.thresholdEquivalencePass,true);
  assert.ok(out.fusion.ht.weights.BIGDB_GLOBAL_PRIOR>0);
  assert.ok(out.fusion.ft.weights.BIGDB_GLOBAL_PRIOR>0);
});

test('Fusion V3 joint trajectory never permits FT below HT',()=>{
  const out=build();
  const state=getMultiMarketFusionV3ResearchState(out);
  assert.ok(state);
  assert.ok(state.jointPaths.length>0);
  for(const p of state.jointPaths){
    assert.ok(p.ftHome>=p.htHome,`${p.ht} -> ${p.ft}`);
    assert.ok(p.ftAway>=p.htAway,`${p.ht} -> ${p.ft}`);
  }
  const mass=state.jointPaths.reduce((s:number,p:any)=>s+p.probability,0);
  assert.ok(Math.abs(mass-1)<1e-9);
});

test('Fusion V3 preserves 3+ HT/O2.5 and 7+ FT/O6.5 equivalence',()=>{
  const out=build();
  assert.ok(Math.abs(out.fusionMarket.thresholds['3+ HT']-out.multiMarket.derivedChecks.htOver2_5)<1e-10);
  assert.ok(Math.abs(out.fusionMarket.thresholds['7+ FT']-out.multiMarket.derivedChecks.ftOver6_5)<1e-10);
});

test('Fusion V3 is invariant to expert input ordering',()=>{
  const a=build(false);
  const b=build(true);
  assert.equal(a.fusion.fingerprint,b.fusion.fingerprint);
  assert.deepEqual(a.fusion.ht.weights,b.fusion.ht.weights);
  assert.deepEqual(a.fusion.ft.weights,b.fusion.ft.weights);
});

test('BigDB is ignored fail-closed when temporal audit is not strict-prior',()=>{
  const badBigDb=structuredClone(bigDb);
  badBigDb.temporalAudit.maxEvidenceDate='2026-09-20';
  badBigDb.temporalAudit.sameDateEvidenceCount=1;
  badBigDb.temporalAudit.verified=false;
  const out=build(false,{bigDb:badBigDb});
  assert.equal(out.bigDb.used,false);
  assert.ok(out.bigDb.reasons.includes('BIGDB_STRICT_PRIOR_NOT_VERIFIED'));
  assert.equal(Object.prototype.hasOwnProperty.call(out.fusion.ht.weights,'BIGDB_GLOBAL_PRIOR'),false);
});

test('BigDB scoreline adapter accepts count-shaped period rows',()=>{
  const normalized=normalizeBigDbScorelinePrior([
    {period:'HT',score:'0-0',count:10},
    {period:'HT',score:'1-0',count:5},
    {period:'FT',score:'1-0',count:8},
    {period:'FT',score:'1-1',count:4},
  ]);
  assert.equal(normalized.ht.length,2);
  assert.equal(normalized.ft.length,2);
  assert.ok(Math.abs(normalized.ht.reduce((s,r)=>s+r.probability,0)-1)<1e-12);
  assert.ok(Math.abs(normalized.ft.reduce((s,r)=>s+r.probability,0)-1)<1e-12);
});
