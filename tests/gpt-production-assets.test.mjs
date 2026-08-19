import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const schemaText = readFileSync(new URL("../gpt-action/openapi.yaml", import.meta.url), "utf8");
const instructions = readFileSync(new URL("../gpt-action/CFI_GPT_INSTRUCTIONS.md", import.meta.url), "utf8");

test("GPT Action OpenAPI parses and preserves production operation IDs", () => {
  const schema = parse(schemaText);
  assert.equal(schema.openapi, "3.1.0");
  assert.equal(schema.info.version, "5.0.2");
  assert.equal(schema.paths["/api/status"].get.operationId, "cfiGetStatus");
  assert.equal(schema.paths["/api/predict"].post.operationId, "cfiPredictMatch");
  assert.equal(schema.paths["/api/prediction-history"].get.operationId, "cfiGetPredictionHistory");
  assert.equal(schema.paths["/api/results"].get.operationId, "cfiGetResults");
  assert.equal(schema.paths["/api/collect-results"].post.operationId, "cfiCollectResults");
  const request = schema.paths["/api/predict"].post.requestBody.content["application/json"].schema;
  assert.ok(request.properties.target_date);
  assert.equal(request.properties.matchDate, undefined);
  assert.deepEqual(request.required, ["home", "away"]);
  assert.equal(schema.components.schemas.Prediction.type, "object");
  assert.equal(schema.components.schemas.Prediction.additionalProperties, true);
  assert.match(schema.info.description, /Strict-prior Persistent DB prediction/);
});

test("GPT Instructions mandate prediction, history, result and settle actions", () => {
  for (const token of ["cfiPredictMatch", "cfiGetPredictionHistory", "cfiGetResults", "cfiCollectResults", "CFI HISTORY", "CFI RESULTS", "CFI SETTLE", "Method A", "Method B", "Final CFI", "Top-3 HT", "Top-3 FT", "Team Trending DNA", "NO_STRONG_SIGNAL"])
    assert.match(instructions, new RegExp(token));
  for (const market of ["3\\+ HT", "7\\+ FT", "Other HT", "Other FT"]) assert.match(instructions, new RegExp(market));
  assert.match(instructions, /Never search File Library/);
  assert.match(instructions, /Never reconstruct a past prediction/);
  assert.match(instructions, /do not manufacture a prediction/i);
});

test("GPT Instructions pin Scoreline Intelligence to current production ownership semantics", () => {
  for (const token of ["target team by team identity", "Do not recompute Top-3 HT/FT", "fixture-side columns", "Historical audit snapshots remain immutable", "unavailable"])
    assert.match(instructions, new RegExp(token));
});

test("Worker production entrypoint preserves result bridge and adds dual shadow wrapper", () => {
  const resultWorker = readFileSync(new URL("../cloudflare-worker/src/index-v47.ts", import.meta.url), "utf8");
  const compatWorker = readFileSync(new URL("../cloudflare-worker/src/index-v48.ts", import.meta.url), "utf8");
  const dualWorker = readFileSync(new URL("../cloudflare-worker/src/index-v49.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /index-v49\.ts/);
  assert.match(resultWorker, /\/api\/prediction-history/);
  assert.match(resultWorker, /\/api\/results/);
  assert.match(resultWorker, /\/api\/collect-results/);
  assert.match(resultWorker, /cfi-gpt-control/);
  assert.match(resultWorker, /resultActions:true/);
  assert.match(compatWorker, /legacyResultBridge/);
  assert.match(compatWorker, /action:'COLLECT'/);
  assert.match(compatWorker, /Do not search File Library/);
  assert.match(compatWorker, /legacyStatusBridge:true/);
  assert.match(dualWorker, /index-v48/);
  assert.match(dualWorker, /HISTORICAL_PRODUCTION/);
  assert.match(dualWorker, /FUTURE_SIX_FACTORS/);
  assert.match(dualWorker, /productionAuthoritative:true/);
  assert.match(dualWorker, /challengerPersisted:false/);
});
