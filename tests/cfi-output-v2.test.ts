import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCfiOutputV2 } from '../src/presentation/cfi-output-v2.ts';

function body(){return {
  target:{home:'Alpha',away:'Beta',date:'2026-08-22'},
  ranking:[
    {target:'3+ HT',probability:.40,confidence:'MEDIUM'},
    {target:'7+ FT',probability:.18,confidence:'MEDIUM'},
    {target:'Other HT',probability:.08,confidence:'HIGH'},
    {target:'Other FT',probability:.12,confidence:'HIGH'},
  ],
  scoreline:{ht:{final:[{score:'1-0',probability:.2}]},ft:{final:[{score:'2-1',probability:.16}]},mostLikelyPath:'1-0 HT → 2-1 FT',uncertainty:'MEDIUM',expectedGoals:{htHome:.8,htAway:.5,ftHome:1.8,ftAway:1.2}},
  consistencyGuard:{status:'PASS'},
  strictPrior:{verified:true},
  multiMarketIntegration:{status:'SHADOW_READY'},
  multiMarket:{
    consistencyGuard:{status:'PASS'},
    oneXTwo:{ht:{home:.43,draw:.35,away:.22},ft:{home:.56,draw:.24,away:.20}},
    overUnder:{
      ht:{'1.5':{over:{fullWin:.48,halfWin:0,push:0,halfLoss:0,fullLoss:.52,fairDecimal:2.083333333},under:{fullWin:.52,halfWin:0,push:0,halfLoss:0,fullLoss:.48,fairDecimal:1.923076923}}},
      ft:{'2.5':{over:{fullWin:.57,halfWin:0,push:0,halfLoss:0,fullLoss:.43,fairDecimal:1.754385965},under:{fullWin:.43,halfWin:0,push:0,halfLoss:0,fullLoss:.57,fairDecimal:2.325581395}}}
    },
    asianHandicap:{
      ht:{'-0.5':{home:{fullWin:.43,halfWin:0,push:0,halfLoss:0,fullLoss:.57,fairDecimal:2.325581395},away:{fullWin:.57,halfWin:0,push:0,halfLoss:0,fullLoss:.43,fairDecimal:1.754385965}}},
      ft:{'-0.5':{home:{fullWin:.56,halfWin:0,push:0,halfLoss:0,fullLoss:.44,fairDecimal:1.785714286},away:{fullWin:.44,halfWin:0,push:0,halfLoss:0,fullLoss:.56,fairDecimal:2.272727273}},'-0.25':{home:{fullWin:.40,halfWin:.16,push:0,halfLoss:.24,fullLoss:.20,fairDecimal:1.636363636},away:{fullWin:.20,halfWin:.24,push:0,halfLoss:.16,fullLoss:.40,fairDecimal:2.571428571}}}
    },
  },
};}

test('without bookmaker odds output never labels champion market BET',()=>{
  const out=buildCfiOutputV2(body());
  assert.equal(out.quickDecision.bet.length,0);
  assert.equal(out.rules.betRequiresOdds,true);
  assert.ok(out.championMarkets.every((x:any)=>x.status==='WATCH'||x.status==='PASS'));
});

test('positive edge with sufficient confidence can be labelled BET',()=>{
  const out=buildCfiOutputV2(body(),{'3+ HT':3.20});
  const row=out.championMarkets.find((x:any)=>x.market==='3+ HT');
  assert.equal(row.status,'BET');
  assert.ok(row.edge>.05);
  assert.equal(row.fairOdds,2.5);
});

test('negative edge is PASS even when payout looks attractive',()=>{
  const out=buildCfiOutputV2(body(),{'Other HT':10});
  const row=out.championMarkets.find((x:any)=>x.market==='Other HT');
  assert.equal(row.status,'PASS');
});

test('all multi-market research families remain SHADOW and never become BET',()=>{
  const out=buildCfiOutputV2(body(),{'FT 1':2.5,'HT O1.5':2.1,'FT AH HOME -0.5':2.2});
  for(const market of ['HT 1','FT 1','HT O1.5','FT O2.5','HT AH HOME -0.5','FT AH HOME -0.5']){
    assert.equal(out.shadowMarkets.find((x:any)=>x.market===market)?.status,'SHADOW',market);
  }
  assert.equal(out.quickDecision.bet.some((x:any)=>x.source==='SHADOW'),false);
  assert.ok(out.shadowMarkets.every((x:any)=>x.status==='SHADOW'));
  assert.equal(out.rules.shadowDecisionUse,false);
});

test('full market output preserves settlement states and engine fair decimal for quarter lines',()=>{
  const out=buildCfiOutputV2(body());
  const row=out.shadowMarkets.find((x:any)=>x.market==='FT AH HOME -0.25');
  assert.ok(row);
  assert.equal(row.status,'SHADOW');
  assert.deepEqual(row.settlement,{fullWin:.40,halfWin:.16,push:0,halfLoss:.24,fullLoss:.20,fairDecimal:1.636363636});
  assert.equal(row.fairOdds,1.636363636);
  assert.equal(out.marketGroups.asianHandicap.ft.some((x:any)=>x.market==='FT AH HOME -0.25'),true);
  assert.equal(out.quality.multiMarketConsistency,'PASS');
  assert.equal(out.rules.quarterAndIntegerLinesExposeSettlementStates,true);
});
