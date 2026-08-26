import test from 'node:test';
import assert from 'node:assert/strict';
import { settleBet, validateBetRecord } from '../src/ledger/bet-ledger.ts';

const bet={confirmed_by_user:true,target_date:'2026-08-26',home:'Alpha',away:'Beta',market_family:'OVER_UNDER',market:'FT O2.75',period:'FT',selection:'OVER',line:2.75,odds:1.95,stake:100000,bookmaker:'Pinnacle',confirmed_at:'2026-08-26T09:00:00Z'};

test('ledger never records a wager without explicit user confirmation',()=>{
  const result=validateBetRecord({...bet,confirmed_by_user:false});
  assert.equal(result.valid,false);assert.ok(result.errors.includes('EXPLICIT_USER_CONFIRMATION_REQUIRED'));
});

test('ledger rejects selections that do not belong to their market family',()=>{
  const base={...bet,confirmed_by_user:true,market_family:'1X2',market:'FT 1X2',selection:'OVER',line:null};
  assert.ok(validateBetRecord(base).errors.includes('1X2_SELECTION_INVALID'));
  assert.ok(validateBetRecord({...bet,market_family:'OVER_UNDER',market:'FT O2.5',selection:'HOME',line:2.5}).errors.includes('OVER_UNDER_SELECTION_INVALID'));
  assert.ok(validateBetRecord({...bet,market_family:'CHAMPION',market:'3+ HT',selection:'3+ HT',period:'FT',line:null}).errors.includes('CHAMPION_PERIOD_MISMATCH'));
});

test('ledger requires a named market for auditability',()=>{
  assert.ok(validateBetRecord({...bet,market:''}).errors.includes('MARKET_REQUIRED'));
});

test('quarter O/U settlement records half-win and exact P/L',()=>{
  const result=settleBet(bet,{htHome:1,htAway:0,ftHome:2,ftAway:1});
  assert.equal(result.state,'HALF_WIN');assert.equal(result.profit,47500);assert.equal(result.returnAmount,147500);
});

test('quarter Asian handicap settlement records half-loss',()=>{
  const result=settleBet({...bet,market_family:'ASIAN_HANDICAP',market:'FT AH HOME -0.25',selection:'HOME',line:-.25,odds:2}, {htHome:0,htAway:0,ftHome:1,ftAway:1});
  assert.equal(result.state,'HALF_LOSS');assert.equal(result.profit,-50000);
});

test('Champion markets preserve frozen definitions',()=>{
  const result=settleBet({...bet,market_family:'CHAMPION',market:'Other FT',selection:'Other FT',line:null}, {htHome:1,htAway:0,ftHome:5,ftAway:1});
  assert.equal(result.state,'FULL_WIN');
});
