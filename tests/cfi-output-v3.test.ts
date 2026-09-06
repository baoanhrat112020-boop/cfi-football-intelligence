import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCfiOutputV3 } from '../src/presentation/cfi-output-v3.ts';

const NOW=Date.parse('2026-08-26T09:00:00Z');
function binary(over:number,fairOver:number,under=1-over,fairUnder=1/under){return{over:{fullWin:over,halfWin:0,push:0,halfLoss:0,fullLoss:under,fairDecimal:fairOver},under:{fullWin:under,halfWin:0,push:0,halfLoss:0,fullLoss:over,fairDecimal:fairUnder}};}
function prediction(promoted=false){
  return{
    target:{home:'Alpha',away:'Beta',date:'2026-08-26'},strictPrior:{verified:true},consistencyGuard:{status:'PASS'},
    bigDbRetrieval:{exactTeam:{home:{retrieved:12},away:{retrieved:12},h2h:{retrieved:2}}},
    ranking:[{target:'3+ HT',probability:.60,confidence:'HIGH'},{target:'7+ FT',probability:.18,confidence:'MEDIUM'}],markets:{'3+ HT':{final:.60,methodB:.32},'Other FT':{final:.16}},
    scoreline:{ht:{final:[{score:'1-1',probability:.2}]},ft:{final:[{score:'3-1',probability:.14}]},expectedGoals:{htHome:.8,htAway:.5,ftHome:1.8,ftAway:1.0},mostLikelyPath:'1-1 HT → 3-1 FT',uncertainty:'MEDIUM'},
    multiMarketIntegration:{status:promoted?'PROMOTED':'SHADOW_READY',decisionUse:promoted},
    multiMarket:{
      consistencyGuard:{status:'PASS'},oneXTwo:{ht:{home:.43,draw:.35,away:.22},ft:{home:.60,draw:.22,away:.18}},
      overUnder:{ht:{'1.5':binary(.48,2.0833),'2.5':binary(.31,3.226)},ft:{'2.5':binary(.62,1.6129),'3.5':binary(.46,2.174),'4.5':binary(.31,3.226),'5.5':binary(.2,5)}},
      asianHandicap:{
        ht:{'-0.25':{home:{fullWin:.43,halfWin:.1,push:0,halfLoss:.2,fullLoss:.27,fairDecimal:2},away:{fullWin:.27,halfWin:.2,push:0,halfLoss:.1,fullLoss:.43,fairDecimal:2.5}},'0.25':{home:{fullWin:.43,halfWin:.2,push:0,halfLoss:.1,fullLoss:.27,fairDecimal:1.7},away:{fullWin:.27,halfWin:.1,push:0,halfLoss:.2,fullLoss:.43,fairDecimal:2.8}}},
        ft:{'-0.75':{home:{fullWin:.45,halfWin:.15,push:0,halfLoss:.2,fullLoss:.2,fairDecimal:1.6667},away:{fullWin:.2,halfWin:.2,push:0,halfLoss:.15,fullLoss:.45,fairDecimal:2.5}},'0.75':{home:{fullWin:.7,halfWin:.1,push:0,halfLoss:.1,fullLoss:.1,fairDecimal:1.3},away:{fullWin:.1,halfWin:.1,push:0,halfLoss:.1,fullLoss:.7,fairDecimal:5}}},
      },
    },
  };
}
const verifiedOdds=(values:any)=>({values,metadata:{bookmaker:'Pinnacle',capturedAt:'2026-08-26T08:50:00Z',verified:true,maxAgeMinutes:30,source:'USER_SCREENSHOT'}});

test('image input exposes provenance but 3+ HT remains WATCH before calibration approval',()=>{
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',now_ms:NOW,fixture_identity:{verified:true},image_evidence:{image_count:3,extracted_fields:['fixture','odds']},odds:verifiedOdds({'3+ HT':2})});
  assert.equal(out.input.mode,'IMAGE_ANALYSIS');
  assert.equal(out.input.imageEvidence.imageCount,3);
  assert.equal(out.odds.fresh,true);
  assert.equal(out.decisions.bet.some((x:any)=>x.market==='3+ HT'),false);
  const row=out.champion.thresholds.find((x:any)=>x.market==='3+ HT');
  assert.equal(row.decision,'WATCH');
  assert.equal(row.decisionUse,false);
  assert.equal(row.calibrationStatus,'CALIBRATION_REQUIRED');
  assert.equal(row.rawProbability,.60);
  assert.equal(row.bettingProbability,null);
  assert.equal(row.edge,null);
  assert.equal(row.expectedValue,null);
  assert.equal(row.fairOdds,null);
  assert.equal(out.threePlusHtSafety.crossCore.status,'FAIL');
  assert.match(out.renderedPracticalReport,/3\+ HT SAFETY: CALIBRATION_REQUIRED/);
});

test('approved calibrated 3+ HT can BET only with equivalence PASS and verified fresh odds',()=>{
  const body:any=prediction();
  body.multiMarket.overUnder.ht['2.5']=binary(.60,1.6667);
  body.threePlusHtCalibrationApproval={status:'APPROVED',version:'CFI_3HT_CAL_V1',calibratedProbability:.55};
  const out=buildCfiOutputV3(body,{input_mode:'IMAGE_ANALYSIS',now_ms:NOW,fixture_identity:{verified:true},odds:verifiedOdds({'3+ HT':2})});
  const row=out.champion.thresholds.find((x:any)=>x.market==='3+ HT');
  assert.equal(out.threePlusHtSafety.crossCore.status,'PASS');
  assert.equal(out.threePlusHtSafety.status,'CALIBRATED_READY');
  assert.equal(row.decisionUse,true);
  assert.equal(row.probability,.55);
  assert.equal(row.bettingProbability,.55);
  assert.equal(row.decision,'BET');
  assert.equal(out.decisions.bet[0].market,'3+ HT');
});

test('legacy or unverified odds can never produce BET',()=>{
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',fixture_identity:{verified:true},now_ms:NOW,odds:{'3+ HT':2.2}});
  assert.equal(out.gates.verifiedOdds,false);
  assert.equal(out.decisions.bet.length,0);
  assert.equal(out.champion.thresholds.find((x:any)=>x.market==='3+ HT').decision,'WATCH');
});

test('image mode requires explicit canonical fixture verification',()=>{
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',now_ms:NOW,odds:verifiedOdds({'3+ HT':2})});
  assert.equal(out.final,'BLOCKED');
  assert.equal(out.gates.fixtureIdentityVerified,false);
});

test('future-dated odds fail the freshness gate',()=>{
  const odds={values:{'3+ HT':2},metadata:{bookmaker:'Pinnacle',capturedAt:'2026-08-26T09:10:00Z',verified:true}};
  const out=buildCfiOutputV3(prediction(),{input_mode:'IMAGE_ANALYSIS',fixture_identity:{verified:true},now_ms:NOW,odds});
  assert.equal(out.gates.freshOdds,false);
  assert.equal(out.decisions.bet.length,0);
});

test('multi-market remains SHADOW until explicit promotion decisionUse',()=>{
  const out=buildCfiOutputV3(prediction(false),{now_ms:NOW,odds:verifiedOdds({'FT 1':2,'FT O2.5':1.9})});
  assert.ok(out.multiMarket.oneXTwo.every((x:any)=>x.decision==='SHADOW'));
  assert.ok(out.multiMarket.overUnder.every((x:any)=>x.decision==='SHADOW'));
  assert.equal(out.multiMarket.policy.decisionUse,false);
});

test('promoted multi-market becomes practical when odds and quality gates pass',()=>{
  const out=buildCfiOutputV3(prediction(true),{input_mode:'DISCOVER_TOP_MATCHES',fixture_identity:{verified:true},now_ms:NOW,odds:verifiedOdds({'FT 1':2,'FT O2.5':1.9})});
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
  const out=buildCfiOutputV3(prediction(true),{now_ms:NOW,odds:verifiedOdds({'FT AH HOME -0.75':2})});
  const row=out.multiMarket.asianHandicap.find((x:any)=>x.market==='FT AH HOME -0.75');
  assert.equal(row.expectedValue,.225);
  assert.equal(row.edge,.2);
  assert.equal(row.edgeType,'FAIR_PRICE_RELATIVE');
  assert.deepEqual(row.settlement,{fullWin:.45,halfWin:.15,push:0,halfLoss:.2,fullLoss:.2,fairDecimal:1.6667});
});

test('practical summary always exposes 1X2, total-goal O/U and AH center lines',()=>{
  const out=buildCfiOutputV3(prediction(),{now_ms:NOW});
  assert.equal(out.marketSummary.oneXTwo.ft.modelPick,'FT 1');
  assert.equal(out.marketSummary.overUnder.ft.projectedGoals.total,2.8);
  assert.equal(out.marketSummary.overUnder.ft.mainLine,2.5);
  assert.equal(out.marketSummary.overUnder.ft.modelLean,'FT O2.5');
  assert.equal(out.marketSummary.asianHandicap.ft.homeModelLine,-.75);
  assert.equal(out.marketSummary.asianHandicap.ft.modelLean,'FT AH HOME -0.75');
  assert.match(out.renderedPracticalReport,/FT 1X2:/);
  assert.match(out.renderedPracticalReport,/FT TOTAL:/);
  assert.match(out.renderedPracticalReport,/FT AH:/);
});

test('verified bookmaker O/U line takes precedence over the model-centered display line',()=>{
  const body=prediction();
  body.scoreline.expectedGoals.ftHome=2.2;body.scoreline.expectedGoals.ftAway=1;
  body.multiMarket.overUnder.ft['3.5']={over:{fullWin:.42,halfWin:0,push:0,halfLoss:0,fullLoss:.58,fairDecimal:2.381},under:{fullWin:.58,halfWin:0,push:0,halfLoss:0,fullLoss:.42,fairDecimal:1.724}};
  const out=buildCfiOutputV3(body,{now_ms:NOW,odds:verifiedOdds({'FT O2.5':1.65,'FT U2.5':2.15})});
  assert.equal(out.marketSummary.overUnder.ft.mainLine,2.5);
  assert.equal(out.marketSummary.overUnder.ft.lineSource,'MARKET_ODDS');
  assert.equal(out.marketSummary.overUnder.ft.over.marketOdds,1.65);
});

test('thin BigDB history blocks practical decisions instead of displaying false confidence',()=>{
  const body=prediction(true);body.bigDbRetrieval.exactTeam.home.retrieved=1;body.bigDbRetrieval.exactTeam.away.retrieved=1;
  const out=buildCfiOutputV3(body,{now_ms:NOW,odds:verifiedOdds({'FT 1':2})});
  assert.equal(out.final,'BLOCKED');
  assert.equal(out.evidenceSufficiency.status,'LIMITED');
  assert.equal(out.gates.evidenceSufficient,false);
  assert.equal(out.decisions.bet.length,0);
});

test('output always exposes quantified explosion scenario and model paths',()=>{
  const out=buildCfiOutputV3(prediction(),{now_ms:NOW});
  assert.equal(out.explosionScenario.thresholds.ht['3Plus'],.31);
  assert.equal(out.explosionScenario.thresholds.ft['4Plus'],.46);
  assert.equal(out.explosionScenario.thresholds.ft['5Plus'],.31);
  assert.equal(out.explosionScenario.thresholds.ft['6Plus'],.2);
  assert.equal(out.explosionScenario.level,'HIGH');
  assert.match(out.renderedPracticalReport,/EXPLOSION: HIGH/);
});

test('output exposes a non-placing bet-ledger handoff',()=>{
  const out=buildCfiOutputV3(prediction(),{now_ms:NOW});
  assert.equal(out.betLedger.status,'NOT_RECORDED');
  assert.equal(out.betLedger.endpoint,'/api/bets');
  assert.equal(out.betLedger.explicitConfirmationRequired,true);
  assert.equal(out.betLedger.autoPlaced,false);
  assert.match(out.renderedPracticalReport,/BET LEDGER: NOT_RECORDED/);
});
