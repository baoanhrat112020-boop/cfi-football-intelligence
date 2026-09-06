import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildRollingEvidenceQueues } from '../../src/discovery/rolling-evidence-queues.mjs';

const INPUT = resolve(
  process.env.CFI_ROLLING_WINDOW_FILE ||
  'local-node/cache/registry/rolling-fixture-window.json'
);
const QUEUE_SET = resolve(
  process.env.CFI_ROLLING_QUEUE_SET_FILE ||
  'local-node/cache/registry/rolling-evidence-queue-set.json'
);
const VERIFIED = resolve(
  process.env.CFI_VERIFIED_RANKING_QUEUE_FILE ||
  'local-node/cache/registry/verified-ranking-queue.json'
);
const CROSSCHECK = resolve(
  process.env.CFI_CROSSCHECK_REQUIRED_QUEUE_FILE ||
  'local-node/cache/registry/crosscheck-required-queue.json'
);
const EVIDENCE_PLAN = resolve(
  process.env.CFI_EVIDENCE_REQUEST_PLAN_FILE ||
  'local-node/cache/registry/evidence-request-plan.json'
);
const AUDIT = resolve(
  process.env.CFI_ROLLING_QUEUE_AUDIT_FILE ||
  'local-node/cache/registry/rolling-evidence-queues-audit.json'
);

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

const rolling = JSON.parse(await readFile(INPUT, 'utf8'));
const queues = buildRollingEvidenceQueues(rolling);

if (queues.metrics.accountedFor !== queues.metrics.rollingFixtures) {
  throw new Error('ROLLING_QUEUE_ACCOUNTING_MISMATCH');
}
if (queues.metrics.droppedByQuota !== 0) {
  throw new Error('ROLLING_QUEUE_QUOTA_DROP_FORBIDDEN');
}
if (queues.verifiedRankingQueue.rows.some(row => row.rankingInputEligible !== true)) {
  throw new Error('VERIFIED_QUEUE_CONTAINS_NON_RANKING_ITEM');
}
if (queues.crosscheckRequiredQueue.rows.some(row => row.rankingInputEligible === true)) {
  throw new Error('CROSSCHECK_QUEUE_CONTAINS_RANKING_READY_ITEM');
}

const audit = {
  contract: 'CFI_ROLLING_EVIDENCE_QUEUES_AUDIT_V1',
  generatedAt: new Date().toISOString(),
  status: 'PASS',
  input: INPUT,
  targetDate: queues.targetDate,
  metrics: queues.metrics,
  evidenceRequests: queues.evidenceRequestPlan.count,
  output: {
    queueSet: QUEUE_SET,
    verifiedRankingQueue: VERIFIED,
    crosscheckRequiredQueue: CROSSCHECK,
    evidenceRequestPlan: EVIDENCE_PLAN
  },
  integration: {
    bigDbImplementation: queues.evidenceRequestPlan.bigDbImplementation,
    webRescueImplementation: queues.evidenceRequestPlan.webRescueImplementation,
    webRescueCandidateInput: queues.evidenceRequestPlan.webRescueCandidateInput,
    existingPipelinesReused: true,
    productionNetworkDispatchPerformed: false
  },
  safety: {
    noRowQuotaDrop: true,
    crosscheckAutoPromotion: false,
    predictionExecutionAllowed: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    productionMutationAllowed: false,
    automaticBetting: false
  }
};

await Promise.all([
  saveJson(QUEUE_SET, queues),
  saveJson(VERIFIED, queues.verifiedRankingQueue),
  saveJson(CROSSCHECK, queues.crosscheckRequiredQueue),
  saveJson(EVIDENCE_PLAN, queues.evidenceRequestPlan),
  saveJson(AUDIT, audit)
]);

console.log(JSON.stringify({
  contract: audit.contract,
  status: audit.status,
  targetDate: audit.targetDate,
  ...audit.metrics,
  evidenceRequests: audit.evidenceRequests,
  productionNetworkDispatchPerformed: false,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
