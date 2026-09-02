import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketChampionFusion, buildMultiMarketChampionFusionV2Challenger, CHAMPION_FUSION_CHALLENGER_VERSION } from '../src/prediction/multi-market-champion-fusion.ts';
import { buildPrediction } from '../src/prediction/final-engine.ts';

const grid=(rows:Array<[string,number]>)=>rows.map(([score,probability])=>{const [home,away]=score.split('-').map(Number);return{score,home,away,total:home+away,probability};});

const incumbent=grid([['0-0',.20],['1-0',.55],['0-1',.15],['1-1',.10]]);
const opposition=grid([['0-0',.10],['1-0',.08],['0-1',.70],['1-1',.12]]);
const ftIncumbent=grid([['0-0',.18],['1-0',.30],['0-1',.15],['1-1',.22],['2-0',.10],['0-2',.05]]);
const ftFuture=grid([['0-0',.14],['1-0',.27],['0-1',.17],['1-1',.23],['2-0',.12],['0-2',.07]]);
const ftHistorical=grid([['0-0',.20],['1-0',.28],['0-1',.16],['1-1',.24],['2-0',.08],['0-2',.04]]);

function args(evidenceCount=20){return{
  targetDate:'2026-09-02',maxEvidenceDate:'2026-09-01',
  ht:{incumbent,futureSix:opposition,historical:opposition},
  ft:{incumbent:ftIncumbent,futureSix:ftFuture,historical:ftHistorical},
  context:{evidenceCount,h2hCount:1,volatility:.25,extremeScorePressure:.18,dominance:.20,goalTempo:.28},
};}

test('V2 challenger stabilizes a weakly supported HT Top-1 flip at distribution layer',()=>{
  const v1:any=buildMultiMarketChampionFusion(args(20));
  const v2:any=buildMultiMarketChampionFusionV2Challenger(args(20));
  assert.equal(v1.champion.top1HT.score,'0-1');
  assert.equal(v2.champion.top1HT.score,'1-0');
  assert.equal(v2.version,CHAMPION_FUSION_CHALLENGER_VERSION);
  assert.equal(v2.gating.ht.stability.triggered,true);
  assert.match(v2.gating.ht.stability.action,/STABILIZED/);
  assert.ok(v2.gating.ht.stability.finalIncumbentWeight>v2.gating.ht.stability.initialIncumbentWeight);
  assert.equal(v2.fusion.labelOverride,false);
  assert.equal(v2.multiMarket.consistencyGuard.status,'PASS');
  assert.ok(Math.abs(v2.champion['3+ HT']-v2.multiMarket.overUnder.ht['2.5'].over.fullWin)<1e-9);
});

test('V2 leaves FT behavior identical to V1',()=>{
  const v1:any=buildMultiMarketChampionFusion(args(20));
  const v2:any=buildMultiMarketChampionFusionV2Challenger(args(20));
  assert.deepEqual(v2.champion.top1FT,v1.champion.top1FT);
  assert.deepEqual(v2.multiMarket.oneXTwo.ft,v1.multiMarket.oneXTwo.ft);
  assert.deepEqual(v2.multiMarket.overUnder.ft,v1.multiMarket.overUnder.ft);
  assert.deepEqual(v2.multiMarket.asianHandicap.ft,v1.multiMarket.asianHandicap.ft);
  assert.equal(v2.gating.ft.stability.action,'UNCHANGED_FROM_V1');
});

test('V2 is fail-closed research only and cannot use development cohort for promotion',()=>{
  const v2:any=buildMultiMarketChampionFusionV2Challenger(args(20));
  assert.equal(v2.researchOnly,true);
  assert.equal(v2.decisionUse,false);
  assert.equal(v2.productionEligible,false);
  assert.equal(v2.promotionRequired,true);
  assert.equal(v2.researchProtocol.developmentOnly,true);
  assert.equal(v2.researchProtocol.sameCohortPromotionAllowed,false);
  assert.equal(v2.researchProtocol.prospectiveResetRequired,true);
  assert.equal(v2.audit.prospectiveEvaluationRequired,true);
  for(const forbidden of ['top3HT','top3FT','Top-3 HT','Top-3 FT'])assert.equal(JSON.stringify(v2).includes(forbidden),false,forbidden);
});

test('V2 blocks if strict-prior provenance is not proven',()=>{
  const bad:any={...args(20),maxEvidenceDate:'2026-09-02'};
  const v2:any=buildMultiMarketChampionFusionV2Challenger(bad);
  assert.equal(v2.status,'CHALLENGER_BLOCKED');
  assert.equal(v2.strictPrior.verified,false);
  assert.ok(v2.uncertainty.reasons.includes('STRICT_PRIOR_PROVENANCE_REQUIRED'));
});

function history(){
  const rows:any[]=[];
  for(let i=1;i<=16;i++){
    const day=String(i).padStart(2,'0');
    rows.push({id:`h${i}`,matchDate:`2026-07-${day}`,homeTeam:'Alpha',awayTeam:`H${i}`,ht:{home:i%3,away:i%2},ft:{home:1+(i%4),away:i%3}});
    rows.push({id:`a${i}`,matchDate:`2026-07-${day}`,homeTeam:`A${i}`,awayTeam:'Beta',ht:{home:i%2,away:(i+1)%3},ft:{home:i%3,away:1+((i+2)%4)}});
  }
  rows.push({id:'hh1',matchDate:'2026-07-20',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:1,away:0},ft:{home:2,away:1}});
  rows.push({id:'hh2',matchDate:'2026-07-25',homeTeam:'Beta',awayTeam:'Alpha',ht:{home:0,away:1},ft:{home:1,away:2}});
  return rows;
}

test('official prediction captures V1 and isolated V2 challenger side by side',()=>{
  const rows=history();
  const p:any=buildPrediction({home:'Alpha',away:'Beta',targetDate:'2026-08-01',language:'vi',homePayload:rows,awayPayload:rows,h2hPayload:rows.filter(x=>(x.homeTeam==='Alpha'&&x.awayTeam==='Beta')||(x.homeTeam==='Beta'&&x.awayTeam==='Alpha'))});
  assert.equal(p.championFusion.version,'CFI_MULTI_MARKET_CHAMPION_FUSION_V1');
  assert.equal(p.championFusionChallenger.version,CHAMPION_FUSION_CHALLENGER_VERSION);
  assert.equal(p.championFusion.decisionUse,false);
  assert.equal(p.championFusionChallenger.decisionUse,false);
  assert.equal(p.championFusionChallenger.audit.v1Unmodified,true);
  assert.equal(p.championFusionChallenger.strictPrior.verified,true);
});
