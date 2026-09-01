import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

export const PRODUCTION_BASELINE_LOCK = Object.freeze({
  version: 'CFI_RESEARCH_PRODUCTION_BASELINE_LOCK_V1',
  repository: 'baoanhrat112020-boop/cfi-football-intelligence',
  commitSha: '518dfb57aafc8428e09b3ec84e440146c839a19e',
  engine: 'CFI_FINAL_V5.3.0',
  runtime: 'CFI_PRIMARY_TOP1_RUNTIME_V2',
  primaryContract: 'CFI_2_METHODS_X_6_TARGETS_V2',
  multiMarketVersion: 'CFI_MULTI_MARKET_V1',
  multiMarketStatus: 'SHADOW_RESEARCH',
  crossMarketCoherence: 'CFI_CROSS_MARKET_COHERENCE_GATE_V1',
  historicalEvaluator: 'CFI_MULTI_MARKET_HISTORICAL_LEARNING_V2.1',
  bigDbRetrieval: 'CFI_BIG_DB_RETRIEVAL_V2.1.2',
  predictionPath: 'NATIVE_V5_3_TOP1_STRICT_PRIOR_BIGDB_V2_1_2',
  productionEntrypoint: 'cloudflare-worker/src/index-live-router.ts',
  prematchEntrypoint: 'cloudflare-worker/src/index-v55.ts',
  decisionUse: false,
  productionMutationAllowed: false,
  sourceBlobs: Object.freeze({
    'src/prediction/final-engine.ts': 'cfee58b47bbbde36c07829c1fbedf9bfb13d4e10',
    'src/prediction/multi-market-v1.ts': 'ed3b9e245d6fac6fc13ef8d78a0dcaf2f704d86f',
    'src/prediction/multi-market-integration.ts': '2825751d563e488d013ec9d05a4193778cbab675',
    'src/prediction/primary-contract-v2.ts': '174db1edbc78608e905b8d1ba86f49b5ff7a772e',
    'cloudflare-worker/src/index-v55.ts': '93b2c87ee985292f30de26287612892922007906',
    'cloudflare-worker/src/index-live-router.ts': 'be7fba38f782a90fca0c3103d14ddbefea4935a7',
  }),
});

function gitBlobSha(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const header = Buffer.from(`blob ${body.length}\0`);
  return createHash('sha1').update(header).update(body).digest('hex');
}

export function verifyProductionBaselineSources(readSource) {
  if (typeof readSource !== 'function') throw new Error('BASELINE_SOURCE_READER_REQUIRED');
  const checked = [];
  const drift = [];
  for (const [file, expectedBlobSha] of Object.entries(PRODUCTION_BASELINE_LOCK.sourceBlobs)) {
    let source;
    try {
      source = readSource(file);
    } catch (error) {
      drift.push({ file, expectedBlobSha, actualBlobSha: null, reason: `READ_FAILED:${error?.message ?? String(error)}` });
      continue;
    }
    const actualBlobSha = gitBlobSha(source);
    checked.push({ file, expectedBlobSha, actualBlobSha });
    if (actualBlobSha !== expectedBlobSha) drift.push({ file, expectedBlobSha, actualBlobSha, reason: 'BLOB_SHA_MISMATCH' });
  }
  if (drift.length) {
    const err = new Error(`PRODUCTION_BASELINE_DRIFT:${drift.map(x => x.file).join(',')}`);
    err.code = 'PRODUCTION_BASELINE_DRIFT';
    err.drift = drift;
    throw err;
  }
  return {
    status: 'PASS',
    lockVersion: PRODUCTION_BASELINE_LOCK.version,
    baselineCommitSha: PRODUCTION_BASELINE_LOCK.commitSha,
    engine: PRODUCTION_BASELINE_LOCK.engine,
    runtime: PRODUCTION_BASELINE_LOCK.runtime,
    primaryContract: PRODUCTION_BASELINE_LOCK.primaryContract,
    multiMarketVersion: PRODUCTION_BASELINE_LOCK.multiMarketVersion,
    crossMarketCoherence: PRODUCTION_BASELINE_LOCK.crossMarketCoherence,
    checked,
    productionMutationAllowed: false,
  };
}

export function verifyProductionBaselineLock(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : REPO_ROOT;
  return verifyProductionBaselineSources(file => fs.readFileSync(path.join(rootDir, file)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(verifyProductionBaselineLock(), null, 2)}\n`);
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
