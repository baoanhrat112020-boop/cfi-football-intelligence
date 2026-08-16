import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const schemaText = readFileSync(new URL("../gpt-action/openapi.yaml", import.meta.url), "utf8");
const instructions = readFileSync(new URL("../gpt-action/CFI_GPT_INSTRUCTIONS.md", import.meta.url), "utf8");

test("GPT Action OpenAPI parses and preserves production operation IDs", () => {
  const schema = parse(schemaText);
  assert.equal(schema.openapi, "3.1.0");
  assert.equal(schema.paths["/api/status"].get.operationId, "cfiGetStatus");
  assert.equal(schema.paths["/api/predict"].post.operationId, "cfiPredictMatch");
  const request = schema.paths["/api/predict"].post.requestBody.content["application/json"].schema;
  assert.ok(request.properties.target_date);
  assert.equal(request.properties.matchDate, undefined);
  assert.deepEqual(request.required, ["home", "away"]);
});

test("GPT Instructions mandate action use and complete mobile output", () => {
  for (const token of ["cfiPredictMatch", "Method A", "Method B", "Final CFI", "Top 3 HT", "Top 3 FT", "Team Trending DNA", "NO_STRONG_SIGNAL", "không có dữ liệu"]) assert.match(instructions, new RegExp(token));
  for (const market of ["3\\+ HT", "7\\+ FT", "Other HT", "Other FT"]) assert.match(instructions, new RegExp(market));
});

test("Worker production entrypoint exposes final runtime version and native fallback", () => {
  const worker = readFileSync(new URL("../cloudflare-worker/src/index-v46.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /index-v46\.ts/);
  assert.match(worker, /buildPrediction/);
  assert.match(worker, /FINAL_VERSION/);
  assert.match(worker, /NOT_FOUND/);
});
