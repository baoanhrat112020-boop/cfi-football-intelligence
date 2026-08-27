import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('production entrypoint preserves BigDB alias resolution and bounded discovery',()=>{
  const p0=read('cloudflare-worker/src/index-p0-router.ts');
  const discovery=read('src/discovery/cfi-discovery.ts');
  assert.match(p0,/databaseFeed/);
  assert.match(p0,/canonicalHomeTeamId/);
  assert.match(p0,/canonicalAwayTeamId/);
  assert.match(p0,/GPT_WEB_SEARCH/);
  assert.match(discovery,/normalizeAiFixtureCandidates/);
});

test('Supabase production deploy includes BigDB retrieval and a real native discovery gate',()=>{
  const workflow=read('.github/workflows/deploy-supabase-gpt-control.yml');
  assert.match(workflow,/supabase\/functions\/cfi-bigdb-retrieval\/\*\*/);
  assert.match(workflow,/supabase\/functions\/cfi-discovery-feed\/\*\*/);
  assert.match(workflow,/functions deploy cfi-bigdb-retrieval/);
  assert.match(workflow,/functions deploy cfi-discovery-feed/);
  assert.match(workflow,/needs: \[verify, deploy\]/);
  assert.match(workflow,/\$BASE\/api\/discover/);
  assert.match(workflow,/predictionSuccess/);
  assert.match(workflow,/fullPredictionsExecuted/);
});

test('final production E2E uses auditable search-first candidates and requests five predictions',()=>{
  const workflow=read('.github/workflows/cfi-final-production-e2e.yml');
  assert.match(workflow,/\$CFI_DISCOVERY_URL/);
  assert.match(workflow,/const requested = 5/);
  assert.match(workflow,/max_matches:5/);
  assert.match(workflow,/fixture_candidates/);
  assert.match(workflow,/GPT_WEB_SEARCH/);
  assert.match(workflow,/sourceUrls:\[providerId,dateSource\]/);
  assert.match(workflow,/discoveredAt/);
  assert.doesNotMatch(workflow,/odds_by_fixture/);
  for(const fixture of ['Bradford City','Newcastle United','Tottenham Hotspur','Preston North End','Real Sociedad']){
    assert.doesNotMatch(workflow,new RegExp(fixture));
  }
});
