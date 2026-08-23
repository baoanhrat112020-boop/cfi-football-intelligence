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
    oneXTwo:{ht:{home:.43,draw:.35,away:.22},ft:{home:.56,draw:.24,away:.20}},
    overUnder:{ht:{'1.5':{over:{fullWin:.48},under:{fullWin:.52}}},ft:{'2.5':{over:{fullWin:.57},under:{fullWin:.43}}}},
    asianHandicap:{ht:{'-0.5':{home:{fullWin:.43},away:{fullWin:.57}}},ft:{'-0.5':{home:{fullWin:.56},away:{fullWin:.44}}}},
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
