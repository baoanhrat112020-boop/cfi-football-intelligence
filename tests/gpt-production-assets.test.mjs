import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

const schemaText=readFileSync(new URL("../gpt-action/openapi.yaml",import.meta.url),"utf8");
const instructions=readFileSync(new URL("../gpt-action/CFI_GPT_INSTRUCTIONS.md",import.meta.url),"utf8");

test("GPT Action OpenAPI parses and exposes P0 discovery plus legacy production operations",()=>{
  const schema=parse(schemaText);
  assert.equal(schema.openapi,"3.1.0");
  assert.equal(schema.paths["/api/status"].get.operationId,"cfiGetStatus");
  assert.equal(schema.paths["/api/discover"].post.operationId,"cfiDiscoverOpportunities");
  assert.equal(schema.paths["/api/predict"].post.operationId,"cfiPredictMatch");
  assert.equal(schema.paths["/api/predict-live"].post.operationId,"cfiPredictLive");
  assert.equal(schema.paths["/api/prediction-history"].get.operationId,"cfiGetPredictionHistory");
  assert.equal(schema.paths["/api/results"].get.operationId,"cfiGetResults");
  assert.equal(schema.paths["/api/collect-results"].post.operationId,"cfiCollectResults");
  const discovery=schema.paths["/api/discover"].post.requestBody.content["application/json"].schema;
  assert.ok(discovery.properties.target_date);
  assert.ok(discovery.properties.timezone);
  assert.ok(discovery.properties.max_matches);
  assert.equal(discovery.properties.response_mode.default,"compact");
  assert.equal(discovery.required.includes("response_mode"),true);
  assert.ok(discovery.properties.fixture_candidates);
  assert.equal(discovery.properties.fixture_candidates.items.required.includes("sourceUrls"),true);
  assert.equal(discovery.properties.internal_provider_diagnostics.default,false);
  assert.equal(discovery.properties.home,undefined);
  assert.equal(discovery.properties.away,undefined);
  const request=schema.paths["/api/predict"].post.requestBody.content["application/json"].schema;
  assert.deepEqual(request.required,["home","away","target_date"]);
  const live=schema.paths["/api/predict-live"].post.requestBody.content["application/json"].schema;
  assert.deepEqual(live.required,["home","away","target_date","live"]);
});

test("GPT instructions route discovery intent without HOME/AWAY and preserve Champion safety",()=>{
  for(const token of [
    "cfiDiscoverOpportunities",
    "GPT must search fixtures first",
    "internal_provider_diagnostics=false",
    "iOS, Android and Windows",
    "NEVER ask the user to provide HOME/AWAY first",
    "CFI DAILY OPPORTUNITY BOARD",
    "cfiPredictMatch",
    "cfiPredictLive",
    "CFI_2_METHODS_X_6_TARGETS_V1",
    "sixTargetMatrix.verification.complete",
    "renderedReport",
    "RENDER_RENDERED_REPORT_VERBATIM",
    "Method A",
    "Method B",
    "FINAL",
    "Top-3 HT",
    "Top-3 FT",
    "SHADOW != ACTIONABLE",
    "decisionUse=false"
  ]) assert.match(instructions,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(instructions,/Never reconstruct/i);
  assert.match(instructions,/Never search File Library/i);
});

test("production config exposes discovery through canonical router chain and preserves V55 Champion",()=>{
  const worker=readFileSync(new URL("../cloudflare-worker/src/index-v55.ts",import.meta.url),"utf8");
  const liveRouter=readFileSync(new URL("../cloudflare-worker/src/index-live-router.ts",import.meta.url),"utf8");
  const config=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
  const p0Url=new URL("../cloudflare-worker/src/index-p0-router.ts",import.meta.url);
  const usesP0=/index-p0-router\.ts/.test(config);
  assert.match(config,/index-(?:p0|live)-router\.ts/);
  if(usesP0){
    assert.equal(existsSync(p0Url),true,"configured P0 router must exist");
    const p0=readFileSync(p0Url,"utf8");
    assert.match(p0,/import base from '\.\/index-live-router\.ts'/);
    assert.match(p0,/\/api\/discover/);
    assert.match(p0,/return base\.fetch\(request,env,ctx\)/);
  }
  assert.match(liveRouter,/import prematch from '\.\/index-v55\.ts'/);
  assert.match(liveRouter,/\/api\/discover/);
  assert.match(liveRouter,/discoverFixtures/);
  assert.match(liveRouter,/futureEvidenceCount/);
  assert.match(liveRouter,/sameDateEvidenceCount/);
  assert.match(liveRouter,/attachMultiMarketShadow/);
  assert.match(liveRouter,/attachCfiBettingBoard/);
  assert.match(liveRouter,/multiMarketDecisionUse:false/);
  assert.match(worker,/CFI_FINAL_V5\.2\.5/);
  assert.match(worker,/CFI_SIX_TARGET_RUNTIME_V1\.4/);
  assert.match(worker,/CFI_MATCH_DIVERSITY_GUARD_V1/);
  assert.match(worker,/ZERO_EXACT_TEAM_EVIDENCE/);
  assert.match(worker,/sixTargetMatrix/);
  assert.match(worker,/renderedReport/);
});

test("result, immutable snapshot and settlement bridges remain reused",()=>{
  const predictionWorker=readFileSync(new URL("../cloudflare-worker/src/index-v50.ts",import.meta.url),"utf8");
  const resultWorker=readFileSync(new URL("../cloudflare-worker/src/index-v47.ts",import.meta.url),"utf8");
  const compatWorker=readFileSync(new URL("../cloudflare-worker/src/index-v48.ts",import.meta.url),"utf8");
  assert.match(predictionWorker,/action:'SNAPSHOT'/);
  assert.match(predictionWorker,/cfi-prediction-audit/);
  assert.match(resultWorker,/\/api\/prediction-history/);
  assert.match(resultWorker,/\/api\/results/);
  assert.match(resultWorker,/\/api\/collect-results/);
  assert.match(compatWorker,/legacyResultBridge/);
  assert.match(compatWorker,/action:'COLLECT'/);
});
