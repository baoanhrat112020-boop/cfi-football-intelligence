import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  discoverFixtures,
  localDateNow
} from '../../src/discovery/cfi-discovery.ts';
import {
  publicDiscoveryToSupplement
} from '../../src/discovery/registry-source-adapters.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const MINIMUM_ROWS = Number(process.env.CFI_PUBLIC_DISCOVERY_MINIMUM_ROWS ?? 100);
const OUTPUT = resolve(
  process.env.CFI_PUBLIC_DISCOVERY_OUTPUT ||
  'local-node/cache/registry/public-discovery.json'
);
const AUDIT = resolve(
  process.env.CFI_PUBLIC_DISCOVERY_AUDIT ||
  'local-node/cache/registry/public-discovery-audit.json'
);

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

const nowMs = Date.now();
const observedAt = new Date(nowMs).toISOString();
const targetDate =
  String(process.env.CFI_TARGET_DATE ?? '').trim() ||
  localDateNow(TIME_ZONE, nowMs);

if (!Number.isFinite(MINIMUM_ROWS) || MINIMUM_ROWS < 1) {
  throw new Error('CFI_PUBLIC_DISCOVERY_MINIMUM_ROWS_INVALID');
}

let discovery;
let thrown = null;

try {
  discovery = await discoverFixtures({
    targetDate,
    timeZone: TIME_ZONE,
    nowMs,
    minimumRows: Math.min(100, Math.floor(MINIMUM_ROWS))
  });
} catch (error) {
  thrown = error instanceof Error ? error.message : String(error);
  discovery = {
    provider: 'NONE',
    providers: [],
    rows: [],
    attempts: [],
    search: {
      requestedRows: Math.min(100, Math.floor(MINIMUM_ROWS)),
      foundRows: 0,
      targetSatisfied: false,
      exhausted: false
    }
  };
}

const supplement = publicDiscoveryToSupplement(discovery, { observedAt });
const attempts = Array.isArray(discovery?.attempts) ? discovery.attempts : [];
const successfulAttempts = attempts.filter(attempt => attempt?.ok === true).length;
const failedAttempts = attempts.filter(attempt => attempt?.ok !== true).length;
const sourceHealth = supplement.telemetry?.sourceHealth ?? null;

const status = thrown
  ? 'FAIL_SOURCE_EXCEPTION'
  : attempts.length > 0 && successfulAttempts === 0
    ? 'FAIL_ALL_PROVIDERS'
    : supplement.rows.length === 0
      ? 'PASS_EMPTY'
      : sourceHealth?.status === 'FALLBACK_ONLY'
        ? 'PASS_FALLBACK_ONLY'
        : sourceHealth?.status === 'SECONDARY_ONLY'
          ? 'PASS_SECONDARY_ONLY'
          : 'PASS';

const audit = {
  contract: 'CFI_PUBLIC_DISCOVERY_AUDIT_V2',
  generatedAt: observedAt,
  status,
  targetDate,
  timeZone: TIME_ZONE,
  requestedRows: Math.min(100, Math.floor(MINIMUM_ROWS)),
  rows: supplement.rows.length,
  providers: supplement.telemetry.providers,
  successfulAttempts,
  failedAttempts,
  search: supplement.telemetry.search,
  sourceHealth,
  error: thrown,
  coveragePolicy: {
    primaryTierRequiredForRankingReadiness: true,
    espnCanSatisfyCoverageReadiness: false,
    theSportsDbCanSatisfyCoverageReadiness: false,
    globalRecallClaimAllowed: false
  },
  safety: {
    shadowOnly: true,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  }
};

await Promise.all([
  saveJson(OUTPUT, supplement),
  saveJson(AUDIT, audit)
]);

console.log(JSON.stringify({
  contract: audit.contract,
  status,
  targetDate,
  rows: supplement.rows.length,
  providers: supplement.telemetry.providers,
  sourceHealth,
  successfulAttempts,
  failedAttempts,
  decisionUse: false,
  bigDbWriteAllowed: false
}));

if (status.startsWith('FAIL_')) {
  process.exitCode = 1;
}
