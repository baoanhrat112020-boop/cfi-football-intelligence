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
  multiMarket:{oneXTwo:{ft:{home:.56,draw:.24,away:.20}}},
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

test('multi-market research outputs remain SHADOW and never become BET',()=>{
  const out=buildCfiOutputV2(body(),{'FT 1':2.5});
  assert.equal(out.shadowMarkets.find((x:any)=>x.market==='FT 1')?.status,'SHADOW');
  assert.equal(out.quickDecision.bet.some((x:any)=>x.source==='SHADOW'),false);
  assert.equal(out.rules.shadowDecisionUse,false);
});
