import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PRIMARY_REQUIRED_METHODS,
  verifyPrimaryContractV2,
} from '../src/prediction/primary-contract-v2.ts';

const markets=['3+ HT','7+ FT','Other HT','Other FT'];

function threshold(){
  return Object.fromEntries(
    markets.map(market=>[
      market,
      {methodA:.2,methodB:.3,final:.25},
    ])
  );
}

function exactScore(){
  return{
    'Top-1 HT':{
      methodA:{score:'0-0',probability:.20},
      methodB:{score:'1-0',probability:.20},
      final:{score:'0-0',probability:.25},
    },
    'Top-1 FT':{
      methodA:{score:'1-0',probability:.15},
      methodB:{score:'1-1',probability:.14},
      final:{score:'1-0',probability:.18},
    },
  };
}

test('V2 requires Method A B FINAL for all six primary targets',()=>{
  assert.deepEqual(
    PRIMARY_REQUIRED_METHODS,
    ['methodA','methodB','final']
  );

  assert.deepEqual(
    verifyPrimaryContractV2(threshold(),exactScore(),markets),
    {
      thresholdComplete:true,
      scorelineComplete:true,
      complete:true,
      thresholdCount:4,
      top1Count:2,
    }
  );
});

test('missing threshold Method A fails closed',()=>{
  const t=threshold();
  t['3+ HT'].methodA=null;

  const r=verifyPrimaryContractV2(t,exactScore(),markets);

  assert.equal(r.thresholdComplete,false);
  assert.equal(r.complete,false);
});

test('missing threshold Method B fails closed',()=>{
  const t=threshold();
  t['Other FT'].methodB=undefined;

  const r=verifyPrimaryContractV2(t,exactScore(),markets);

  assert.equal(r.thresholdComplete,false);
  assert.equal(r.complete,false);
});

test('missing Top-1 Method B score fails closed',()=>{
  const x=exactScore();
  x['Top-1 HT'].methodB={score:'',probability:.20};

  const r=verifyPrimaryContractV2(threshold(),x,markets);

  assert.equal(r.scorelineComplete,false);
  assert.equal(r.complete,false);
});

test('missing Top-1 probability fails closed and null is not zero',()=>{
  const x=exactScore();
  x['Top-1 FT'].methodA={score:'1-0',probability:null};

  const r=verifyPrimaryContractV2(threshold(),x,markets);

  assert.equal(r.scorelineComplete,false);
  assert.equal(r.complete,false);
});

test('out-of-range probability fails closed',()=>{
  const x=exactScore();
  x['Top-1 FT'].final={score:'1-0',probability:1.01};

  const r=verifyPrimaryContractV2(threshold(),x,markets);

  assert.equal(r.complete,false);
});

test('production wrapper returns RUNTIME_CONTRACT_ERROR 422',()=>{
  const worker=fs.readFileSync(
    new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),
    'utf8',
  );

  assert.match(worker,/verifyPrimaryContractV2\(threshold,exactScore,MARKET_CODES\)/);
  assert.match(worker,/sixTargetMatrix\?\.verification\?\.complete!==true/);
  assert.match(worker,/body\.status='RUNTIME_CONTRACT_ERROR'/);
  assert.match(worker,/body\.error='RUNTIME_CONTRACT_ERROR'/);
  assert.match(worker,/predictionPath:'RUNTIME_CONTRACT_FAIL_CLOSED'/);
  assert.match(worker,/return Response\.json\(body,\{status:422\}\)/);
});