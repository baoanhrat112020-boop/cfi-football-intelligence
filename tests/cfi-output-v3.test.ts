import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCfiOutputV3 } from '../src/presentation/cfi-output-v3.ts';

const NOW=Date.parse('2026-08-26T09:00:00Z');
function prediction(promoted=false){return{target:{home:'Alpha',away:'Beta',date:'2026-08-26'},strictPrior:{verified:true},consistencyGuard:{status:'PASS'},ranking:[{target:'3+ HT',probability:.60,confidence:'HIGH'},{target:'7+ FT',probability:.18,confidence:'MEDIUM'}],scoreline:{ht:{final:[{score:'1-1',probability:.2}]},ft:{final:[{score:'3-1',probability:.14}]},mostLikelyPath:'1-1 HT → 3-1 FT'},multiMarketIntegration:{status:promoted?'PROMOTED':'SHADOW_READY',decisionUse:promoted},multiMarket:{consistencyGuard:{status:'PASS'},oneXTwo:{ft:{home:.60,draw:.22,away:.18}},overUnder:{ft:{'2.5':{over:{fullWin:.62,halfWin:0,push:0,halfLoss:0,fullLoss:.38,fairDecimal:1.6129},under:{fullWin:.38,halfWin:0,push:0,halfLoss:0,fullLoss:.62,fairDecimal:2.6316}}}},asianHandicap:{ft:{'-0.25':{home:{fullWin:.45,halfWin:.15,push:0,halfLoss:.2,fullLoss:.2,fairDecimal:1.6667},away:{fullWin:.2,halfWin:.2,push:0,halfLoss:.15,fullLoss:.45,fairDecimal:2.5}}}}}};}
const verifiedOdds=(values:any)=>({values,metadata:{bookmaker:'Pinnacle',capturedAt:'2026-08-26T08:50:00Z',verified:true,maxAgeMinutes:30,source:'USER_SCREENSHOT'}});

test('image input exposes provenance and can BET only with verified fresh odds',()=>{
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',now_ms:NOW,fixture_identity:{verified:true},image_evidence:{image_count:3,extracted_fields:['fixture','odds']},odds:verifiedOdds({'3+ HT':2})});
  assert.equal(out.input.mode,'IMAGE_ANALYSIS');
  assert.equal(out.input.imageEvidence.imageCount,3);
  assert.equal(out.odds.fresh,true);
  assert.equal(out.decisions.bet[0].market,'3+ HT');
  assert.match(out.renderedPracticalReport,/BET 3\+ HT/);
});

test('legacy or unverified odds can never produce BET',()=>{
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',now_ms:NOW,odds:{'3+ HT':2.2}});
  assert.equal(out.gates.verifiedOdds,false);
  assert.equal(out.decisions.bet.length,0);
  assert.equal(out.champion.thresholds.find((x:any)=>x.market==='3+ HT').decision,'WATCH');
});

test('multi-market remains SHADOW until explicit promotion decisionUse',()=>{
  const out=buildCfiOutputV3(prediction(false),{now_ms:NOW,odds:verifiedOdds({'FT 1':2,'FT O2.5':1.9})});
  assert.ok(out.multiMarket.oneXTwo.every((x:any)=>x.decision==='SHADOW'));
  assert.ok(out.multiMarket.overUnder.every((x:any)=>x.decision==='SHADOW'));
  assert.equal(out.multiMarket.policy.decisionUse,false);
});

test('promoted multi-market becomes practical when odds and quality gates pass',()=>{
  const out=buildCfiOutputV3(prediction(true),{input_mode:'DISCOVER_TOP_MATCHES',now_ms:NOW,odds:verifiedOdds({'FT 1':2,'FT O2.5':1.9})});
  assert.equal(out.multiMarket.policy.decisionUse,true);
  assert.equal(out.multiMarket.oneXTwo.find((x:any)=>x.market==='FT 1').decision,'BET');
  assert.equal(out.input.mode,'DISCOVER_TOP_MATCHES');
});

test('strict-prior failure blocks every decision',()=>{
  const body=prediction();body.strictPrior.verified=false;
  const out=buildCfiOutputV3(body,{now_ms:NOW,odds:verifiedOdds({'3+ HT':2})});
  assert.equal(out.final,'BLOCKED');
  assert.ok(out.decisions.blocked.length>0);
});

test('quarter-line expected value uses full and half settlement states',()=>{
  const out=buildCfiOutputV3(prediction(true),{now_ms:NOW,odds:verifiedOdds({'FT AH HOME -0.25':2})});
  const row=out.multiMarket.asianHandicap.find((x:any)=>x.market==='FT AH HOME -0.25');
  assert.equal(row.expectedValue,.225);
  assert.equal(row.edge,.2);
  assert.equal(row.edgeType,'FAIR_PRICE_RELATIVE');
  assert.deepEqual(row.settlement,{fullWin:.45,halfWin:.15,push:0,halfLoss:.2,fullLoss:.2,fairDecimal:1.6667});
});
