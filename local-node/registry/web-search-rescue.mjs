import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../src/discovery/cfi-discovery.ts';
import {
  webSearchCandidatesToSupplement
} from '../../src/discovery/registry-source-adapters.mjs';
import {
  partitionWebRescueCandidates
} from '../../src/discovery/web-alias-gap-audit.mjs';

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
const UNRESOLVED = resolve(
  process.env.CFI_WEB_RESCUE_UNRESOLVED_FILE ||
  'local-node/cache/registry/live-bigdb-unresolved.json'
);
const ALIAS_AUDIT = resolve(
  process.env.CFI_WEB_ALIAS_GAP_AUDIT_FILE ||
  'local-node/cache/registry/web-alias-gap-audit.json'
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

async function readUnresolved(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.rows)) return parsed.rows;
    return [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

const nowMs = Date.now();
const generatedAt = new Date(nowMs).toISOString();
const targetDate =
  String(process.env.CFI_TARGET_DATE ?? '').trim() ||
  localDateNow(TIME_ZONE, nowMs);

const [input, unresolvedRows] = await Promise.all([
  readCandidates(INPUT),
  readUnresolved(UNRESOLVED)
]);
const partition = partitionWebRescueCandidates(input.candidates, unresolvedRows, {
  generatedAt
});
const supplement = webSearchCandidatesToSupplement(
  partition.accepted,
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
      : partition.aliasReview.length > 0 && supplement.rows.length > 0
        ? 'PASS_WITH_ALIAS_REVIEW'
        : partition.aliasReview.length > 0
          ? 'PASS_ALIAS_REVIEW_ONLY'
          : supplement.rows.length > 0
            ? 'PASS'
            : supplement.rejected.length > 0 || partition.rejected.length > 0
              ? 'PASS_REJECTED_ALL'
              : 'PASS_EMPTY';

const combinedRejected = [
  ...partition.rejected,
  ...supplement.rejected
];
const audit = {
  contract: 'CFI_WEB_SEARCH_RESCUE_AUDIT_V3',
  generatedAt,
  status,
  targetDate,
  timeZone: TIME_ZONE,
  inputFile: INPUT,
  unresolvedFile: UNRESOLVED,
  aliasAuditFile: ALIAS_AUDIT,
  inputCandidates: input.candidates.length,
  unresolvedFixtures: unresolvedRows.length,
  acceptedForNormalization: partition.accepted.length,
  aliasReviewRequired: partition.aliasReview.length,
  accepted: supplement.rows.length,
  rejected: combinedRejected.length,
  rejectionReasons: combinedRejected.reduce((acc, row) => {
    const reason = String(row?.reason ?? 'UNKNOWN');
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {}),
  sourceHealth: supplement.sourceHealth,
  error: input.readError ?? null,
  policy: {
    ...supplement.policy,
    rescueJoinRequiresExactIdentityKey: true,
    rescueJoinRequiresExactKickoff: true,
    aliasCandidateCanCreateFixture: false,
    aliasCandidateAutoUpsertAllowed: false
  },
  safety: {
    webSearchCanRescuePcMisses: true,
    prioritySourcePolicyEnforced: true,
    espnCanSatisfyCoverageReadiness: false,
    httpsProvenanceRequired: true,
    sourceFailureDeletesFixture: false,
    aliasReviewCanMutateRegistry: false,
    aliasReviewCanWriteBigDb: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  }
};

await Promise.all([
  saveJson(OUTPUT, supplement),
  saveJson(ALIAS_AUDIT, partition),
  saveJson(AUDIT, audit)
]);

console.log(JSON.stringify({
  contract: audit.contract,
  status,
  targetDate,
  acceptedForNormalization: audit.acceptedForNormalization,
  aliasReviewRequired: audit.aliasReviewRequired,
  accepted: audit.accepted,
  rejected: audit.rejected,
  sourceHealth: audit.sourceHealth,
  decisionUse: false,
  bigDbWriteAllowed: false
}));

if (status.startsWith('FAIL_')) {
  process.exitCode = 1;
}
