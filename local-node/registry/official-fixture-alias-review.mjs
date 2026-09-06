import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../src/discovery/cfi-discovery.ts';
import { buildOfficialFixtureAliasReview } from '../../src/discovery/official-fixture-alias-review.mjs';

const clean = value => String(value ?? '').trim();
const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const HINTS_FILE = resolve(
  process.env.CFI_OFFICIAL_ALIAS_REVIEW_HINTS_FILE ||
  'local-node/browser/fixture-collector/input/bongdawap-candidates.json'
);
const OFFICIAL_FILE = resolve(
  process.env.CFI_OFFICIAL_ALIAS_REVIEW_OFFICIAL_FILE ||
  'audit-reports/cfi-kwff-web-rescue-shadow-live.json'
);
const OUTPUT = resolve(
  process.env.CFI_OFFICIAL_ALIAS_REVIEW_OUTPUT ||
  'audit-reports/cfi-official-fixture-alias-review.json'
);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

const nowMs = Date.now();
const targetDate = clean(process.env.CFI_TARGET_DATE) || localDateNow(TIME_ZONE, nowMs);
const [hintBody, officialBody] = await Promise.all([
  readJson(HINTS_FILE),
  readJson(OFFICIAL_FILE)
]);

const hints = Array.isArray(hintBody)
  ? hintBody
  : Array.isArray(hintBody?.dateUnverified)
    ? hintBody.dateUnverified
    : [];
const officialRows = Array.isArray(officialBody)
  ? officialBody
  : Array.isArray(officialBody?.runtimeRows)
    ? officialBody.runtimeRows
    : [];

const missingInputs = [];
if (!hintBody) missingInputs.push('HINTS_FILE_MISSING');
if (!officialBody) missingInputs.push('OFFICIAL_FILE_MISSING');

const review = buildOfficialFixtureAliasReview(hints, officialRows, {
  targetDate,
  timeZone: TIME_ZONE,
  officialProvider: clean(officialBody?.provider) || 'KWFF',
  generatedAt: new Date(nowMs).toISOString()
});

const output = {
  ...review,
  status: missingInputs.length
    ? 'DEGRADED_MISSING_INPUT'
    : officialBody?.status && officialBody.status !== 'PASS'
      ? 'DEGRADED_OFFICIAL_SOURCE_NOT_PASS'
      : 'PASS',
  inputs: {
    hintsFile: HINTS_FILE,
    officialFile: OFFICIAL_FILE,
    hintsContract: hintBody?.contract ?? null,
    officialContract: officialBody?.contract ?? null,
    officialStatus: officialBody?.status ?? null,
    missingInputs
  },
  safety: {
    shadowOnly: true,
    autoAliasAllowed: false,
    canonicalTeamCreateAllowed: false,
    registryIngestAllowed: false,
    rankingInputEligible: false,
    predictionExecutionAllowed: false,
    bigDbNetworkInvoked: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false,
    productionMutationAllowed: false,
    decisionUse: false
  }
};

await saveJson(OUTPUT, output);
console.log(JSON.stringify({
  contract: output.contract,
  status: output.status,
  targetDate,
  hints: output.metrics.hints,
  officialFixtures: output.metrics.officialFixtures,
  proposals: output.metrics.proposals,
  ambiguous: output.metrics.ambiguous,
  rejected: output.metrics.rejected,
  autoAliasAllowed: false,
  canonicalTeamCreateAllowed: false,
  registryIngestAllowed: false,
  bigDbWriteAllowed: false,
  decisionUse: false
}));

if (output.status === 'DEGRADED_MISSING_INPUT') process.exitCode = 2;
