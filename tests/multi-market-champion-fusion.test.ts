import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketChampionFusion, CHAMPION_FUSION_VERSION } from '../src/prediction/multi-market-champion-fusion.ts';

const grid=(rows:Array<[string,number]>)=>rows.map(([score,probability])=>{const [h,a]=score.split('-').map(Number);return{score,home:h,away:a,total:h+a,probability};});
const incumbent=grid([['0-0',.16],['1-0',.24],['0-1',.16],['1-1',.20],['2-0',.10],['0-2',.06],['2-1',.05],['1-2',.03]]);
const future=grid([['0-0',.09],['1-0',.19],['0-1',.12],['1-1',.18],['2-0',.15],['0-2',.08],['2-1',.12],['1-2',.07]]);
const historical=grid([['0-0',.18],['1-0',.23],['0-1',.17],['1-1',.21],['2-0',.08],['0-2',.06],['2-1',.04],['1-2',.03]]);

function run(evidenceCount=36){return buildMultiMarketChampionFusion({
  targetDate:'2026-08-27',maxEvidenceDate:'2026-08-26',
  ht:{incumbent,futureSix:future,historical},ft:{incumbent,futureSix:future,historical},
  context:{evidenceCount,h2hCount:4,volatility:.62,extremeScorePressure:.55,dominance:.25,goalTempo:.58},
});}

test('Champion Fusion creates one coherent shadow distribution for every market',()=>{
  const x=run();
  assert.equal(x.version,CHAMPION_FUSION_VERSION);
  assert.equal(x.status,'SHADOW_READY');
  assert.equal(x.researchOnly,true);
  assert.equal(x.decisionUse,false);
  assert.equal(x.productionEligible,false);
  assert.equal(x.multiMarket.consistencyGuard.status,'PASS');
  assert.equal(x.fusion.singleLatentDistribution,true);
  assert.equal(x.fusion.deriveAllMarketsFromFusedDistribution,true);
  const htWeight=Object.values(x.gating.ht).reduce((a,b)=>a+b,0);
  const ftWeight=Object.values(x.gating.ft).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(htWeight-1)<1e-9);
  assert.ok(Math.abs(ftWeight-1)<1e-9);
  assert.ok(Math.abs(x.champion['3+ HT']-x.multiMarket.overUnder.ht['2.5'].over.fullWin)<1e-9);
  assert.ok(Math.abs(x.champion['7+ FT']-x.multiMarket.overUnder.ft['6.5'].over.fullWin)<1e-9);
});

test('Champion Fusion abstains instead of pretending confidence on thin evidence',()=>{
  const x=run(5);
  assert.equal(x.decisionUse,false);
  assert.equal(x.uncertainty.abstain,true);
  assert.ok(x.uncertainty.reasons.includes('THIN_EVIDENCE'));
});

test('Champion Fusion blocks when strict-prior provenance is not proven',()=>{
  const x=buildMultiMarketChampionFusion({targetDate:'2026-08-27',maxEvidenceDate:'2026-08-27',ht:{incumbent,futureSix:future,historical},ft:{incumbent,futureSix:future,historical},context:{evidenceCount:30,h2hCount:2}});
  assert.equal(x.status,'SHADOW_BLOCKED');
  assert.equal(x.strictPrior.verified,false);
  assert.ok(x.uncertainty.reasons.includes('STRICT_PRIOR_PROVENANCE_REQUIRED'));
});
