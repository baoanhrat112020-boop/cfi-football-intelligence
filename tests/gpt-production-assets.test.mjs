import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const schemaText = readFileSync(new URL("../gpt-action/openapi.yaml", import.meta.url), "utf8");
const instructions = readFileSync(new URL("../gpt-action/CFI_GPT_INSTRUCTIONS.md", import.meta.url), "utf8");

test("GPT Action OpenAPI parses and preserves production operation IDs", () => {
  const schema = parse(schemaText);
  assert.equal(schema.openapi, "3.1.0");
  assert.equal(schema.info.version, "5.2.1");
  assert.equal(schema.paths["/api/status"].get.operationId, "cfiGetStatus");
  assert.equal(schema.paths["/api/predict"].post.operationId, "cfiPredictMatch");
  assert.equal(schema.paths["/api/prediction-history"].get.operationId, "cfiGetPredictionHistory");
  assert.equal(schema.paths["/api/results"].get.operationId, "cfiGetResults");
  assert.equal(schema.paths["/api/collect-results"].post.operationId, "cfiCollectResults");
  const request = schema.paths["/api/predict"].post.requestBody.content["application/json"].schema;
  assert.ok(request.properties.target_date);
  assert.deepEqual(request.required, ["home", "away"]);
  const prediction = schema.components.schemas.Prediction;
  assert.equal(prediction.additionalProperties, true);
  assert.deepEqual(prediction.required, ["sixTargetMatrix", "renderedReport", "presentationContract"]);
  assert.equal(schema.components.schemas.SixTargetMatrix.properties.contract.const, "CFI_2_METHODS_X_6_TARGETS_V1");
  assert.equal(schema.components.schemas.PresentationContract.properties.mode.const, "RENDER_RENDERED_REPORT_VERBATIM");
  assert.equal(schema.components.schemas.Top3MethodSet.properties.methodA.minItems, 3);
  assert.equal(schema.components.schemas.Top3MethodSet.properties.methodB.minItems, 3);
  assert.equal(schema.components.schemas.Top3MethodSet.properties.final.minItems, 3);
});

test("GPT instructions require the canonical rendered 2 methods x 6 targets contract", () => {
  for (const token of [
    "cfiPredictMatch",
    "CFI_2_METHODS_X_6_TARGETS_V1",
    "sixTargetMatrix.verification.complete",
    "renderedReport",
    "RENDER_RENDERED_REPORT_VERBATIM",
    "Method A",
    "Method B",
    "FINAL",
    "Top-3 HT",
    "Top-3 FT",
    "RUNTIME CONTRACT ERROR",
    "Never collapse Top-3 HT or Top-3 FT into a single list",
  ]) assert.match(instructions, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const market of ["3\\+ HT", "7\\+ FT", "Other HT", "Other FT"]) assert.match(instructions, new RegExp(market));
  assert.match(instructions, /Never reconstruct/);
  assert.match(instructions, /Never search File Library/);
});

test("production worker returns canonical rendered report and fails closed on incomplete six-target output", () => {
  const worker = readFileSync(new URL("../cloudflare-worker/src/index-v49.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /index-v49\.ts/);
  assert.match(worker, /buildPrediction/);
  assert.match(worker, /FINAL_VERSION/);
  assert.match(worker, /CFI_SIX_TARGET_RUNTIME_V1\.1/);
  assert.match(worker, /CFI_2_METHODS_X_6_TARGETS_V1/);
  assert.match(worker, /NATIVE_V5_2_STRICT_PRIOR/);
  assert.match(worker, /sixTargetMatrix/);
  assert.match(worker, /renderedReport/);
  assert.match(worker, /RENDER_RENDERED_REPORT_VERBATIM/);
  assert.match(worker, /thresholdComplete/);
  assert.match(worker, /scorelineComplete/);
  assert.match(worker, /INCOMPLETE_2_METHODS_X_6_TARGETS/);
  assert.match(worker, /TOP-3 HT — PRIMARY TARGET/);
  assert.match(worker, /TOP-3 FT — PRIMARY TARGET/);
  assert.doesNotMatch(worker, /NOT_YET_MODELED/);
  assert.doesNotMatch(worker, /buildFutureSixPrediction/);
});

test("result and settlement bridge remain preserved below v49", () => {
  const resultWorker = readFileSync(new URL("../cloudflare-worker/src/index-v47.ts", import.meta.url), "utf8");
  const compatWorker = readFileSync(new URL("../cloudflare-worker/src/index-v48.ts", import.meta.url), "utf8");
  assert.match(resultWorker, /\/api\/prediction-history/);
  assert.match(resultWorker, /\/api\/results/);
  assert.match(resultWorker, /\/api\/collect-results/);
  assert.match(resultWorker, /cfi-gpt-control/);
  assert.match(compatWorker, /legacyResultBridge/);
  assert.match(compatWorker, /action:'COLLECT'/);
});
