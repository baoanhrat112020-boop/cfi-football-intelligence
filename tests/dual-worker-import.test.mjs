import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-worker/src/index-v49.ts";

test("dual-model worker entrypoint loads and exposes fetch", () => {
  assert.ok(worker);
  assert.equal(typeof worker.fetch, "function");
});
