import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCfiBettingBoard } from '../src/presentation/cfi-betting-board.ts';

const card=(overrides:any)=>({market:'3+ HT',probability:.4,fairOdds:2.5,confidence:'MEDIUM',status:'PASS',marketOdds:null,edge:null,source:'CHAMPION',...overrides});

test('Betting Board ranks strong qualified value in tier A and caps stake',()=>{
  const output={match:{home:'A',away:'B',date:'2026-08-22'},championMarkets:[
    card({market:'Core',probability:.64,fairOdds:1.5625,marketOdds:2,edge:.14,status:'BET',confidence:'HIGH'}),
  ],shadowMarkets:[]};
  const board=buildCfiBettingBoard(output);
  assert.equal(board.sections.A_bestValue.length,1);
  assert.equal(board.primary.market,'Core');
  assert.equal(board.primary.tier,'A_BEST_VALUE');
  assert.ok(board.primary.stakeUnits>0);
  assert.ok(board.primary.stakeUnits<=1.5);
});

test('Extreme tail without qualified edge is monitor-only high risk',()=>{
  const output={championMarkets:[card({market:'Other FT',probability:.12,status:'PASS',marketOdds:12,edge:.0367})],shadowMarkets:[]};
  const board=buildCfiBettingBoard(output);
  assert.equal(board.sections.C_highRiskExtreme.length,1);
  assert.equal(board.sections.C_highRiskExtreme[0].stakeUnits,0);
  assert.equal(board.sections.C_highRiskExtreme[0].risk,'EXTREME');
});

test('Shadow markets can never receive stake or actionable tier',()=>{
  const output={championMarkets:[],shadowMarkets:[card({market:'FT 1',probability:.7,fairOdds:1.429,marketOdds:2.2,edge:.2455,status:'SHADOW',source:'SHADOW'})]};
  const board=buildCfiBettingBoard(output);
  assert.equal(board.sections.shadow.length,1);
  assert.equal(board.sections.shadow[0].stakeUnits,0);
  assert.equal(board.sections.A_bestValue.length,0);
});

test('WATCH market stays tier B with zero stake',()=>{
  const output={championMarkets:[card({market:'3+ HT',probability:.58,status:'WATCH',marketOdds:1.9,edge:.0537})],shadowMarkets:[]};
  const board=buildCfiBettingBoard(output);
  assert.equal(board.sections.B_goodWatch.length,1);
  assert.equal(board.sections.B_goodWatch[0].stakeUnits,0);
});
