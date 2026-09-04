import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../src/discovery/cfi-discovery.ts';
import {
  webSearchCandidatesToSupplement
} from '../../src/discovery/registry-source-adapters.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const INPUT = resolve(
  process.env.CFI_WEB_RESCUE_INPUT_FILE ||
  'local-node/cache/registry/web-search-candidates.json'
);
const OUTPUT = resolve(
  process.env.CFI_WEB_RESCUE_OUTPUT_FILE ||
  'local-node/cache/registry/web-search-rescue.json'
);
const AUDIT = resolve(
  process.env.CFI_WEB_RESCUE_AUDIT_FILE ||
  'local-node/cache/registry/web-search-rescue-audit.json'
);

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

async function readCandidates(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) return { candidates: parsed, missing: false };
    if (Array.isArray(parsed?.candidates)) {
      return { candidates: parsed.candidates, missing: false };
    }
    return { candidates: [], missing: false, invalidShape: true };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { candidates: [], missing: true };
    }
    return {
      candidates: [],
      missing: false,
      readError: error instanceof Error ? error.message : String(error)
    };
  }
}

const nowMs = Date.now();
const generatedAt = new Date(nowMs).toISOString();
const targetDate =
  String(process.env.CFI_TARGET_DATE ?? '').trim() ||
  localDateNow(TIME_ZONE, nowMs);

const input = await readCandidates(INPUT);
const supplement = webSearchCandidatesToSupplement(
  input.candidates,
  {
    targetDate,
    timeZone: TIME_ZONE,
    nowMs
  }
);

const status = input.readError
  ? 'FAIL_INPUT_READ'
  : input.invalidShape
    ? 'FAIL_INPUT_SHAPE'
    : input.missing
      ? 'NO_INPUT'
      : supplement.rows.length > 0
        ? 'PASS'
        : supplement.rejected.length > 0
          ? 'PASS_REJECTED_ALL'
          : 'PASS_EMPTY';

const audit = {
  contract: 'CFI_WEB_SEARCH_RESCUE_AUDIT_V2',
  generatedAt,
  status,
  targetDate,
  timeZone: TIME_ZONE,
  inputFile: INPUT,
  inputCandidates: input.candidates.length,
  accepted: supplement.rows.length,
  rejected: supplement.rejected.length,
  rejectionReasons: supplement.rejected.reduce((acc, row) => {
    const reason = String(row?.reason ?? 'UNKNOWN');
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {}),
  sourceHealth: supplement.sourceHealth,
  error: input.readError ?? null,
  policy: supplement.policy,
  safety: {
    webSearchCanRescuePcMisses: true,
    prioritySourcePolicyEnforced: true,
    espnCanSatisfyCoverageReadiness: false,
    httpsProvenanceRequired: true,
    sourceFailureDeletesFixture: false,
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
  accepted: audit.accepted,
  rejected: audit.rejected,
  sourceHealth: audit.sourceHealth,
  decisionUse: false,
  bigDbWriteAllowed: false
}));

if (status.startsWith('FAIL_')) {
  process.exitCode = 1;
}
