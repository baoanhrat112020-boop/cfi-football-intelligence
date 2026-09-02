import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoveryFinal } from '../cloudflare-worker/src/discovery-final.ts';
import { compactDiscoveryRow } from '../cloudflare-worker/src/discovery-compact.ts';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('V1.4 reports completed predictions truthfully',()=>{
  const router=read('cloudflare-worker/src/index-p0-router.ts');
  const finalState=read('cloudflare-worker/src/discovery-final.ts');
  assert.match(router,/fullPredictionsExecuted:predictionSuccess/);
  assert.doesNotMatch(router,/fullPredictionsExecuted:predictionAttempts/);
  assert.match(finalState,/Number\(counts\.predictionSuccess\)!==0/);
  assert.match(finalState,/DISCOVERY_UNAVAILABLE/);
  assert.match(finalState,/PREDICTION_NOT_EXECUTED/);
  assert.match(finalState,/INSUFFICIENT_EVIDENCE/);
  const acceptance=read('.github/workflows/cfi-final-production-e2e.yml');
  assert.match(acceptance,/predictionAttempts:n\(counts\?\.predictionAttempts\)/);
  assert.match(acceptance,/predictionSuccess:n\(counts\?\.predictionSuccess\)/);
  assert.match(acceptance,/noForcedFive:body\?\.rules\?\.noForcedFive/);
  assert.match(acceptance,/PREDICTION_ATTEMPTS_EXCEED_INPUT/);
  assert.doesNotMatch(acceptance,/fullPredictionsExecuted\s*[:=]\s*predictionAttempts/);
});

test('native discovery fails closed with a truthful terminal reason before any prediction succeeds',async()=>{
  const cases=[
    [{fixturesDiscovered:0,predictionAttempts:0,predictionSuccess:0,insufficient:0},'DISCOVERY_UNAVAILABLE'],
    [{fixturesDiscovered:2,predictionAttempts:0,predictionSuccess:0,insufficient:0},'PREDICTION_NOT_EXECUTED'],
    [{fixturesDiscovered:2,predictionAttempts:2,predictionSuccess:0,insufficient:2},'INSUFFICIENT_EVIDENCE'],
    [{fixturesDiscovered:2,predictionAttempts:2,predictionSuccess:0,insufficient:1},'PREDICTION_NOT_EXECUTED'],
  ];
  for(const [counts,expected] of cases){assert.equal(discoveryFinal({action:'CFI_DISCOVERY',counts,final:'NO_BET'}),expected);}
  assert.equal(discoveryFinal({action:'CFI_DISCOVERY',counts:{fixturesDiscovered:1,predictionAttempts:1,predictionSuccess:1,insufficient:0},final:'NO_BET'}),'NO_BET');
});

test('native discovery retries transient database-feed and catalog failures before provider fallback',()=>{
  const router=read('cloudflare-worker/src/index-p0-router.ts');
  const feed=read('supabase/functions/cfi-discovery-feed/index.ts');
  assert.match(router,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(router,/if\(attempt===0\)await new Promise/);
  assert.match(feed,/for\(let attempt=0;attempt<3;attempt\+\+\)/);
  assert.match(feed,/150\*\(attempt\+1\)/);
});

test('compact GPT discovery keeps decision contracts but removes oversized technical payloads',()=>{
  const row=compactDiscoveryRow({match:'A vs B',strictPrior:true,status:'WATCH',multiMarketDecisionUse:false,prediction:{status:'SUCCESS',fullMarketReport:'x'.repeat(100000),renderedReport:'y'.repeat(100000),sixTargetMatrix:{contract:'CFI_2_METHODS_X_6_TARGETS_V1',verification:{complete:true}},temporalEvidenceAudit:{verified:true},multiMarketIntegration:{status:'SHADOW_BLOCKED',decisionUse:false},outputV2:{visibility:{fullMultiMarketVisible:true,allTargetsExposed:true,decisionUse:false}}}});
  assert.equal(row.prediction.sixTargetMatrix.verification.complete,true);
  assert.equal(row.prediction.multiMarketVisibility.fullMultiMarketVisible,true);
  assert.equal(row.prediction.fullMarketReport,undefined);
  assert.equal(row.prediction.renderedReport,undefined);
  assert.ok(JSON.stringify(row).length<10000);
});

test('BigDB resolution stays exact and bridges provider club-name formatting without fuzzy matching',()=>{
  const migration=read('supabase/sql/cfi_team_alias_resolution_v1.sql');
  const override=read('supabase/sql/cfi_team_alias_resolution_v1_1.sql');
  const retrieval=read('supabase/functions/cfi-bigdb-retrieval/index.ts');
  const runtime=read('cloudflare-worker/src/index-v50.ts');
  assert.match(migration,/where alias_normalized = public\.cfi_normalize_team_name\(v_input\)/);
  assert.doesNotMatch(migration,/similarity\s*\(/i);
  const aliasPos=override.indexOf('from public.team_aliases');const canonicalPos=override.indexOf('from public.teams',aliasPos+1);assert.ok(aliasPos>=0&&canonicalPos>aliasPos,'curated alias lookup must precede canonical exact lookup');
  assert.match(retrieval,/db\.rpc\('cfi_resolve_team_name'/);
  assert.match(retrieval,/CANONICAL_FOLDED_EXACT/);
  assert.match(retrieval,/CANONICAL_CLUB_KEY_EXACT/);
  assert.match(retrieval,/AMBIGUOUS_EXACT_IDENTITY_KEY/);
  assert.ok(retrieval.includes('CFI_BIG_DB_RETRIEVAL_V2.3.1_SHARED_IDENTITY_BRIDGE'));
  assert.doesNotMatch(retrieval,/similarity\s*\(/i);
  assert.match(retrieval,/homeResolution\?\.status==='RESOLVED'/);
  const identityPos=runtime.indexOf('const identity=fixtureIdentityAudit(big)');
  const exactPos=runtime.indexOf('const exact=exactTeamEvidenceAudit(big)');
  assert.ok(identityPos>=0&&exactPos>identityPos,'canonical identity audit must precede exact-team evidence gate');
  assert.match(runtime,/const predictionHome=identity\.homeCanonical!,predictionAway=identity\.awayCanonical!/);
  assert.match(runtime,/prediction\.target=\{home,away,date:targetDate,canonicalHome:predictionHome,canonicalAway:predictionAway\}/);
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

test('final production E2E follows GPT Core V4 supplied-fixture contract without forced five',()=>{
  const workflow=read('.github/workflows/cfi-final-production-e2e.yml');
  assert.match(workflow,/\$CFI_DISCOVERY_URL/);
  assert.match(workflow,/CFI_FEED_URL/);
  assert.match(workflow,/fixture_candidates:candidates/);
  assert.match(workflow,/internal_provider_diagnostics:false/);
  assert.match(workflow,/SUPPLIED_FIXTURE_ONLY/);
  assert.match(workflow,/NO_FORCED_FIVE_CONTRACT_MISSING/);
  assert.match(workflow,/PROVIDER_FALLBACK_ON_SHORTFALL/);
  assert.match(workflow,/PROVIDER_MISMATCH_/);
  assert.match(workflow,/EXTERNAL_SUPPLIED/);
  assert.doesNotMatch(workflow,/internal_provider_diagnostics\\":true/);
  for(const fixture of ['Bradford City','Newcastle United','Tottenham Hotspur','Preston North End','Real Sociedad']){assert.doesNotMatch(workflow,new RegExp(fixture));}
});

test('production discovery has one provider fallback owner and no duplicate worker crawler by default',()=>{
  const router=read('cloudflare-worker/src/index-p0-router.ts');
  assert.match(router,/const providerFallbackTriggered=rows\.length<requestedRows/);
  assert.match(router,/workerProviderFallbackAllowed:false/);
  assert.match(router,/providerFallbackReason:providerFallbackTriggered\?'CANONICAL_DATABASE_FEED_OWNS_PROVIDER_FALLBACK':null/);
  assert.match(router,/canonicalFeedOwnsProviderFallback:true/);
  assert.match(router,/providerDiagnosticsPriority:'AFTER_BIGDB_PREFLIGHT_AND_PREDICTION'/);
  assert.match(router,/noDuplicateWorkerProviderCrawler:true/);
  const feedStart=router.indexOf('async function feed('),deferredStart=router.indexOf('async function runDeferredProviderDiagnostics');
  assert.ok(feedStart>=0&&deferredStart>feedStart);
  assert.doesNotMatch(router.slice(feedStart,deferredStart),/discoverFixtures\s*\(/);
});

test('discovery predicts only evidence-ready candidates and keeps filling after failures',()=>{
  const router=read('cloudflare-worker/src/index-p0-router.ts');
  assert.match(router,/homeN>0&&awayN>0&&temporal/);
  assert.match(router,/const evidenceReady=preflight\.filter\(x=>x\.ready\)/);
  assert.match(router,/for\(const rejected of evidenceRejected\)diagnostics\.push\(preflightDiagnostic\(rejected\)\)/);
  assert.doesNotMatch(router,/canonicalRows=\[\.\.\.evidenceReady,\.\.\.evidenceUnknown\]/);
  assert.match(router,/evaluated\.length<maxMatches/);
  assert.match(router,/const remaining=maxMatches-evaluated\.length/);
  assert.match(router,/engineSucceeded&&strictPrior&&score\.eligible&&evaluated\.length<maxMatches/);
  assert.match(router,/continueAfterCandidateFailure:true/);
  assert.match(router,/stopAtSuccessfulMaxMatches:true/);
});