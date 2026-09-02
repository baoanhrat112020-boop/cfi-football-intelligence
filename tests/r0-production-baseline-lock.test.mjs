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

test('R0 baseline is pinned to reproducible V5.3.1 Top-1 V2 Multi-Market V2.2 lineage', () => {
  const result = verifyProductionBaselineLock();
  assert.equal(result.status, 'PASS');
  assert.equal(PRODUCTION_BASELINE_LOCK.commitSha, '8ca9a3634f536f2f838135df062f5bbbf7da0d9a');
  assert.equal(PRODUCTION_BASELINE_LOCK.engine, 'CFI_FINAL_V5.3.1');
  assert.equal(PRODUCTION_BASELINE_LOCK.numericalCoreEngine, 'CFI_FINAL_V5.3.1');
  assert.equal(PRODUCTION_BASELINE_LOCK.productionRuntimeReportedEngine, 'CFI_FINAL_V5.3.0');
  assert.equal(PRODUCTION_BASELINE_LOCK.runtimeTelemetryMatchesNumericalCore, false);
  assert.equal(PRODUCTION_BASELINE_LOCK.runtimeTelemetryStatus, 'LABEL_LAGS_NUMERICAL_CORE');
  assert.equal(PRODUCTION_BASELINE_LOCK.runtime, 'CFI_PRIMARY_TOP1_RUNTIME_V2');
  assert.equal(PRODUCTION_BASELINE_LOCK.primaryContract, 'CFI_2_METHODS_X_6_TARGETS_V2');
  assert.equal(PRODUCTION_BASELINE_LOCK.multiMarketVersion, 'CFI_MULTI_MARKET_V1');
  assert.equal(PRODUCTION_BASELINE_LOCK.crossMarketCoherence, 'CFI_CROSS_MARKET_COHERENCE_GATE_V1');
  assert.equal(PRODUCTION_BASELINE_LOCK.historicalEvaluator, 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.2');
  assert.equal(PRODUCTION_BASELINE_LOCK.decisionUse, false);
  assert.equal(PRODUCTION_BASELINE_LOCK.productionMutationAllowed, false);
  assert.equal(R0_DATASET_CONTRACT.baselineCommitSha, PRODUCTION_BASELINE_LOCK.commitSha);
  assert.equal(R0_DATASET_CONTRACT.productionChampion, PRODUCTION_BASELINE_LOCK.engine);
  assert.equal(R0_DATASET_CONTRACT.numericalCoreEngine, PRODUCTION_BASELINE_LOCK.numericalCoreEngine);
  assert.equal(R0_DATASET_CONTRACT.productionRuntimeReportedEngine, PRODUCTION_BASELINE_LOCK.productionRuntimeReportedEngine);
  assert.equal(R0_DATASET_CONTRACT.runtimeTelemetryMatchesNumericalCore, false);
  assert.equal(R0_DATASET_CONTRACT.productionRuntime, PRODUCTION_BASELINE_LOCK.runtime);
  assert.equal(R0_DATASET_CONTRACT.primaryContract, PRODUCTION_BASELINE_LOCK.primaryContract);
  assert.equal(R0_DATASET_CONTRACT.multiMarketVersion, PRODUCTION_BASELINE_LOCK.multiMarketVersion);
});

test('baseline source lock explicitly proves numerical V5.3.1 with production telemetry label still V5.3.0', () => {
  const numerical = readRepoSource('src/prediction/final-engine.ts').toString('utf8');
  const prematch = readRepoSource('cloudflare-worker/src/index-v55.ts').toString('utf8');
  const live = readRepoSource('cloudflare-worker/src/index-live-router.ts').toString('utf8');
  assert.match(numerical, /FINAL_VERSION = "CFI_FINAL_V5\.3\.1"/);
  assert.match(prematch, /const ENGINE_VERSION='CFI_FINAL_V5\.3\.0'/);
  assert.match(live, /const PREMATCH_ENGINE='CFI_FINAL_V5\.3\.0'/);
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