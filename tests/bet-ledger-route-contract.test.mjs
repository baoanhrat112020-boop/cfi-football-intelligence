import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router=readFileSync(new URL('../cloudflare-worker/src/index-p0-router.ts',import.meta.url),'utf8');
const openapi=readFileSync(new URL('../gpt-action/openapi.yaml',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/cfi-bet-ledger/index.ts',import.meta.url),'utf8');

test('production exposes the user-confirmed bet ledger without placing wagers',()=>{
  assert.match(router,/u\.pathname==='\/api\/bets'/);
  assert.match(router,/cfi-bet-ledger/);
  assert.match(router,/target\.search=new URL\(request\.url\)\.search/);
  assert.match(router,/request\.method!=='GET'&&request\.method!=='POST'/);
  assert.match(openapi,/^  \/api\/bets:/m);
  assert.match(openapi,/cfiRecordOrSettleBet/);
  assert.match(openapi,/confirmed_by_user/);
  assert.match(openapi,/never places a wager/);
  assert.match(edge,/result_provenance/);
  assert.match(edge,/Object\.keys\(body\.result_provenance\)\.length===0/);
});
