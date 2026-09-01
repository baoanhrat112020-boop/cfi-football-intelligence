import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRODUCTION_BASELINE_LOCK,
  verifyProductionBaselineLock,
  verifyProductionBaselineSources,
} from '../research/production-baseline-lock.mjs';
import { R0_DATASET_CONTRACT } from '../research/run-r0-bulk.mjs';

function readRepoSource(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url));
}

test('R0 baseline is pinned to current production V5.3 Top-1 V2 Multi-Market V1', () => {
  const result = verifyProductionBaselineLock();
  assert.equal(result.status, 'PASS');
  assert.equal(PRODUCTION_BASELINE_LOCK.commitSha, '518dfb57aafc8428e09b3ec84e440146c839a19e');
  assert.equal(PRODUCTION_BASELINE_LOCK.engine, 'CFI_FINAL_V5.3.0');
  assert.equal(PRODUCTION_BASELINE_LOCK.runtime, 'CFI_PRIMARY_TOP1_RUNTIME_V2');
  assert.equal(PRODUCTION_BASELINE_LOCK.primaryContract, 'CFI_2_METHODS_X_6_TARGETS_V2');
  assert.equal(PRODUCTION_BASELINE_LOCK.multiMarketVersion, 'CFI_MULTI_MARKET_V1');
  assert.equal(PRODUCTION_BASELINE_LOCK.crossMarketCoherence, 'CFI_CROSS_MARKET_COHERENCE_GATE_V1');
  assert.equal(PRODUCTION_BASELINE_LOCK.historicalEvaluator, 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1');
  assert.equal(PRODUCTION_BASELINE_LOCK.decisionUse, false);
  assert.equal(PRODUCTION_BASELINE_LOCK.productionMutationAllowed, false);
  assert.equal(R0_DATASET_CONTRACT.baselineCommitSha, PRODUCTION_BASELINE_LOCK.commitSha);
  assert.equal(R0_DATASET_CONTRACT.productionChampion, PRODUCTION_BASELINE_LOCK.engine);
  assert.equal(R0_DATASET_CONTRACT.productionRuntime, PRODUCTION_BASELINE_LOCK.runtime);
  assert.equal(R0_DATASET_CONTRACT.primaryContract, PRODUCTION_BASELINE_LOCK.primaryContract);
  assert.equal(R0_DATASET_CONTRACT.multiMarketVersion, PRODUCTION_BASELINE_LOCK.multiMarketVersion);
});

test('R0 baseline guard fails closed if any pinned production source drifts', () => {
  const target = 'src/prediction/multi-market-v1.ts';
  assert.throws(
    () => verifyProductionBaselineSources(file => {
      const body = readRepoSource(file);
      return file === target ? Buffer.concat([body, Buffer.from('\n// synthetic drift\n')]) : body;
    }),
    error => error?.code === 'PRODUCTION_BASELINE_DRIFT' && String(error?.message).includes(target),
  );
});
