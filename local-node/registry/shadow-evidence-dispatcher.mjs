import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildShadowEvidenceDispatch,
  resolveBigDbRetrievalUrl
} from '../../src/discovery/shadow-evidence-dispatcher.mjs';

const INPUT = resolve(
  process.env.CFI_EVIDENCE_REQUEST_PLAN_FILE ||
  'local-node/cache/registry/evidence-request-plan.json'
);
const RECEIPTS = resolve(
  process.env.CFI_SHADOW_EVIDENCE_RECEIPTS_FILE ||
  'local-node/cache/registry/shadow-evidence-receipts.json'
);
const WEB_PLAN = resolve(
  process.env.CFI_WEB_CROSSCHECK_REQUEST_PLAN_FILE ||
  'local-node/cache/registry/web-crosscheck-request-plan.json'
);
const REVERIFY = resolve(
  process.env.CFI_NEXT_CYCLE_REVERIFICATION_FILE ||
  'local-node/cache/registry/next-cycle-reverification-candidates.json'
);
const AUDIT = resolve(
  process.env.CFI_SHADOW_EVIDENCE_AUDIT_FILE ||
  'local-node/cache/registry/shadow-evidence-dispatcher-audit.json'
);
const DATE_CONTEXT_QUEUE = resolve(
  process.env.CFI_DATE_CONTEXT_QUEUE_FILE ||
  'local-node/cache/registry/cycle1-crosscheck-required-queue.json'
);
const DATE_CONTEXT_PROBE = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);
const DATE_CONTEXT_AUDIT = resolve(
  process.env.CFI_DATE_CONTEXT_AUDIT_FILE ||
  'local-node/cache/registry/cycle1-browser-date-context-audit.json'
);

const LIVE_REQUESTED = process.env.CFI_SHADOW_EVIDENCE_LIVE === '1';
const MAX_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.CFI_SHADOW_EVIDENCE_CONCURRENCY ?? 4) || 4)
);
const TIMEOUT_MS = Math.max(
  1000,
  Math.min(20_000, Number(process.env.CFI_SHADOW_EVIDENCE_TIMEOUT_MS ?? 8000) || 8000)
);
const CYCLE_ID = String(process.env.CFI_ORCHESTRATOR_CYCLE_ID ?? '').trim() || null;

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: 'NON_JSON_RESPONSE', message: String(text ?? '').slice(0, 500) };
  }
}

async function oneFetch(url, key, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cfi-key': key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    return {
      httpStatus: response.status,
      body: safeJson(text),
      error: null
    };
  } catch (error) {
    return {
      httpStatus: null,
      body: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchWithRetry(url, key, request) {
  const body = request?.bigDb?.request?.body ?? {};
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    last = await oneFetch(url, key, body);
    const status = Number(last?.httpStatus);
    const retryable =
      last?.error ||
      !Number.isFinite(status) ||
      status === 408 ||
      status === 429 ||
      status >= 500;
    if (!retryable || attempt === 2) {
      return { ...last, attempts: attempt };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { ...last, attempts: 2 };
}

async function boundedMap(rows, worker, concurrency) {
  const out = new Array(rows.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      out[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, rows.length)) }, run)
  );
  return out;
}

const plan = await readJson(INPUT);
const requests = Array.isArray(plan?.requests) ? plan.requests : [];
const baseResolution = resolveBigDbRetrievalUrl(process.env.CFI_DB_BASE_URL);
const dbKey = String(process.env.CFI_DB_KEY ?? '').trim();
const liveEnabled = LIVE_REQUESTED && baseResolution.ok && Boolean(dbKey);
const configReason = !LIVE_REQUESTED
  ? 'LIVE_READ_NOT_REQUESTED'
  : !baseResolution.ok
    ? baseResolution.reason
    : !dbKey
      ? 'CFI_DB_KEY_MISSING'
      : null;

const resultMap = new Map();
let networkAttempts = 0;

if (liveEnabled) {
  const results = await boundedMap(
    requests,
    request => dispatchWithRetry(baseResolution.url, dbKey, request),
    MAX_CONCURRENCY
  );
  for (let i = 0; i < requests.length; i += 1) {
    const request = requests[i];
    const result = results[i];
    networkAttempts += Number(result?.attempts ?? 0);
    resultMap.set(request?.requestId, result);
  }
}

const generatedAt = new Date().toISOString();
const dispatch = buildShadowEvidenceDispatch(plan, resultMap, {
  liveReadEnabled: liveEnabled,
  generatedAt,
  sourceCycleId: CYCLE_ID
});

if (dispatch.metrics.receipts !== dispatch.metrics.requests) {
  throw new Error('EVIDENCE_RECEIPT_ACCOUNTING_MISMATCH');
}
if (dispatch.metrics.droppedByQuota !== 0) {
  throw new Error('EVIDENCE_RECEIPT_DROP_FORBIDDEN');
}
if (dispatch.metrics.autoPromoted !== 0) {
  throw new Error('SAME_CYCLE_AUTO_PROMOTION_FORBIDDEN');
}
if (dispatch.receipts.some(row => row.rankingReady === true)) {
  throw new Error('DISPATCHER_MUST_NOT_SET_RANKING_READY');
}
if (dispatch.receipts.some(row => row.predictionExecutionAllowed === true)) {
  throw new Error('DISPATCHER_MUST_NOT_ENABLE_PREDICTION');
}
if (dispatch.receipts.some(row => row.bigDbWriteAllowed === true)) {
  throw new Error('DISPATCHER_MUST_NOT_ENABLE_BIGDB_WRITE');
}

let dateContextAudit = null;
const dateContextEligible =
  await exists(DATE_CONTEXT_QUEUE) &&
  await exists(DATE_CONTEXT_PROBE);
if (dateContextEligible) {
  process.env.CFI_DATE_CONTEXT_QUEUE_FILE = DATE_CONTEXT_QUEUE;
  process.env.CFI_BROWSER_PROBE_AUDIT = DATE_CONTEXT_PROBE;
  process.env.CFI_DATE_CONTEXT_AUDIT_FILE = DATE_CONTEXT_AUDIT;
  await import(`../../tools/cfi-browser-date-context-audit.mjs?cycle=${encodeURIComponent(CYCLE_ID ?? generatedAt)}`);
  dateContextAudit = await readJson(DATE_CONTEXT_AUDIT);
}

const audit = {
  contract: 'CFI_SHADOW_EVIDENCE_DISPATCHER_AUDIT_V2',
  generatedAt,
  status: liveEnabled
    ? dispatch.metrics.bigDbUnauthorized > 0
      ? 'PASS_WITH_BIGDB_UNAUTHORIZED'
      : dispatch.metrics.bigDbUnavailable > 0 || dispatch.metrics.bigDbErrors > 0
        ? 'PASS_WITH_BIGDB_DEGRADATION'
        : 'PASS_LIVE_READ_ONLY'
    : LIVE_REQUESTED
      ? 'PASS_LIVE_CONFIG_REQUIRED'
      : 'PASS_SHADOW_NO_NETWORK',
  sourceCycleId: CYCLE_ID,
  input: {
    evidenceRequestPlan: INPUT,
    requests: requests.length
  },
  liveRead: {
    requested: LIVE_REQUESTED,
    enabled: liveEnabled,
    configReason,
    endpointConfigured: baseResolution.ok,
    actionKeyConfigured: Boolean(dbKey),
    endpointPath: baseResolution.ok ? '/cfi-bigdb-retrieval' : null,
    authHeader: 'x-cfi-key',
    networkAttempts,
    maxConcurrency: MAX_CONCURRENCY,
    timeoutMs: TIMEOUT_MS,
    serviceRoleKeyUsed: false
  },
  dateContextAudit: dateContextAudit
    ? {
        performed: true,
        output: DATE_CONTEXT_AUDIT,
        contract: dateContextAudit.contract,
        status: dateContextAudit.status,
        fixtures: dateContextAudit.fixtures,
        providerContexts: dateContextAudit.providerContexts,
        statusCounts: dateContextAudit.statusCounts,
        contextClassifications: dateContextAudit.contextClassifications
      }
    : {
        performed: false,
        reason: 'CYCLE1_QUEUE_OR_BROWSER_PROBE_NOT_PRESENT'
      },
  metrics: dispatch.metrics,
  output: {
    receipts: RECEIPTS,
    webCrosscheckPlan: WEB_PLAN,
    nextCycleReverification: REVERIFY,
    dateContextAudit: dateContextAudit ? DATE_CONTEXT_AUDIT : null
  },
  integration: {
    bigDbBaseEnv: 'CFI_DB_BASE_URL',
    bigDbKeyEnv: 'CFI_DB_KEY',
    matchesExistingCloudflareEvidencePreflightContract: true,
    webRescueCandidateInput: dispatch.webCrosscheckPlan.ingestFile,
    webRescueImplementation: dispatch.webCrosscheckPlan.existingIngestImplementation,
    sameCycleRegistryMutationPerformed: false
  },
  safety: {
    ...dispatch.safety,
    dateContextCanMutateKickoff: false,
    dateContextCanMutateIdentity: false
  }
};

await Promise.all([
  saveJson(RECEIPTS, {
    contract: dispatch.contract,
    generatedAt,
    sourceCycleId: CYCLE_ID,
    rows: dispatch.receipts,
    count: dispatch.receipts.length,
    decisionUse: false,
    bigDbWriteAllowed: false
  }),
  saveJson(WEB_PLAN, dispatch.webCrosscheckPlan),
  saveJson(REVERIFY, dispatch.nextCycleReverification),
  saveJson(AUDIT, audit)
]);

console.log(JSON.stringify({
  contract: audit.contract,
  status: audit.status,
  sourceCycleId: CYCLE_ID,
  liveReadRequested: LIVE_REQUESTED,
  liveReadEnabled: liveEnabled,
  configReason,
  dateContextAudit: audit.dateContextAudit,
  ...dispatch.metrics,
  networkAttempts,
  actionKeyConfigured: Boolean(dbKey),
  serviceRoleKeyUsed: false,
  sameCycleRegistryMutationPerformed: false,
  predictionExecutionAllowed: false,
  decisionUse: false,
  bigDbWriteAllowed: false
}));
