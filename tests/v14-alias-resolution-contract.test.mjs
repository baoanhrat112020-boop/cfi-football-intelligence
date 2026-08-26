import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('V1.4 reports completed predictions truthfully',()=>{
  const router=read('cloudflare-worker/src/index-p0-router.ts');
  assert.match(router,/fullPredictionsExecuted:predictionSuccess/);
  assert.doesNotMatch(router,/fullPredictionsExecuted:predictionAttempts/);
  const acceptance=read('.github/workflows/cfi-final-production-e2e.yml');
  assert.match(acceptance,/if\(!\(Number\(c\.predictionSuccess\)>0\)\)fail\('predictionSuccess <= 0'\)/);
  assert.match(acceptance,/if\(!\(Number\(c\.fullPredictionsExecuted\)>0\)\)fail\('fullPredictionsExecuted <= 0'\)/);
  assert.doesNotMatch(acceptance,/fullPredictionsExecuted\s*[:=]\s*predictionAttempts/);
});

test('BigDB resolution stays exact and bridges provider club-name formatting without fuzzy matching',()=>{
  const migration=read('supabase/sql/cfi_team_alias_resolution_v1.sql');
  const override=read('supabase/sql/cfi_team_alias_resolution_v1_1.sql');
  const retrieval=read('supabase/functions/cfi-bigdb-retrieval/index.ts');
  const runtime=read('cloudflare-worker/src/index-v50.ts');
  assert.match(migration,/where alias_normalized = public\.cfi_normalize_team_name\(v_input\)/);
  assert.doesNotMatch(migration,/similarity\s*\(/i);
  assert.ok(override.indexOf('from public.team_aliases')<override.indexOf('from public.teams\n  where lower'));
  assert.match(retrieval,/db\.rpc\('cfi_resolve_team_name'/);
  assert.match(retrieval,/CANONICAL_FOLDED_EXACT/);
  assert.match(retrieval,/CANONICAL_CLUB_KEY_EXACT/);
  assert.match(retrieval,/AMBIGUOUS_EXACT_IDENTITY_KEY/);
  assert.match(retrieval,/CFI_BIG_DB_RETRIEVAL_V2\.3\.0_IDENTITY_KEY_EXACT/);
  assert.doesNotMatch(retrieval,/similarity\s*\(/i);
  assert.match(retrieval,/homeResolution\?\.status==='RESOLVED'/);
  assert.match(runtime,/predictionHome=String\(big\?\.identity\?\.homeCanonical\|\|home\)/);
  assert.match(runtime,/prediction\.target=\{home,away,date:targetDate\}/);
});

test('Supabase production deploy includes BigDB retrieval and a real native discovery gate',()=>{
  const workflow=read('.github/workflows/deploy-supabase-gpt-control.yml');
  assert.match(workflow,/supabase\/functions\/cfi-bigdb-retrieval\/\*\*/);
  assert.match(workflow,/functions deploy cfi-bigdb-retrieval/);
  assert.match(workflow,/\$BASE\/api\/discover/);
  assert.match(workflow,/predictionSuccess/);
  assert.match(workflow,/fullPredictionsExecuted/);
});

test('final production E2E is native discovery with zero predetermined fixture cohort',()=>{
  const workflow=read('.github/workflows/cfi-final-production-e2e.yml');
  assert.match(workflow,/\$BASE\/api\/discover/);
  assert.match(workflow,/Injected\/predetermined fixture input forbidden/);
  assert.match(workflow,/aiCandidatesReceived!==0\|\|x\.search\?\.aiCandidatesAccepted!==0/);
  for(const fixture of ['Bradford City','Newcastle United','Tottenham Hotspur','Preston North End','Real Sociedad']){
    assert.doesNotMatch(workflow,new RegExp(fixture));
  }
});
