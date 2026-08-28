import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

import {
  normalizeCandidate,
  validateCandidate
} from "./contract.mjs";

const DEFAULT_INPUT = resolve(
  "local-node/browser/fixture-collector/input/candidates.json"
);

const OUTPUT = resolve(
  "local-node/cache/browser/fixture-candidates.json"
);

const AUDIT_OUTPUT = resolve(
  "local-node/cache/browser/fixture-collector-audit.json"
);

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });

  await writeFile(
    path,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

async function loadCandidates(path) {
  try {
    const parsed = JSON.parse(
      await readFile(path, "utf8")
    );

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (Array.isArray(parsed.candidates)) {
      return parsed.candidates;
    }

    throw new Error(
      "INPUT_MUST_BE_ARRAY_OR_CANDIDATES_ARRAY"
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

const inputArg = process.argv.find(
  x => x.startsWith("--input=")
);

const inputFile = inputArg
  ? resolve(inputArg.slice("--input=".length))
  : DEFAULT_INPUT;

console.log("CFI BROWSER FIXTURE COLLECTOR");
console.log("MODE: CONTRACT_BOOTSTRAP");
console.log("");

const raw = await loadCandidates(inputFile);

const accepted = [];
const rejected = [];

const now = new Date();

for (const candidate of raw) {
  const validation = validateCandidate(
    candidate,
    now
  );

  if (!validation.valid) {
    rejected.push({
      candidate,
      reasons: validation.errors
    });

    continue;
  }

  accepted.push(
    normalizeCandidate(candidate)
  );
}

const uniqueMap = new Map();
const duplicates = [];

for (const candidate of accepted) {
  if (uniqueMap.has(candidate.identity_key)) {
    duplicates.push(candidate);
    continue;
  }

  uniqueMap.set(
    candidate.identity_key,
    candidate
  );
}

const unique = [...uniqueMap.values()];

const coverage = {};

for (const candidate of unique) {
  const key = candidate.competition_class;

  coverage[key] =
    (coverage[key] ?? 0) + 1;
}

const manifest = {
  contract: "CFI_BROWSER_FIXTURE_MANIFEST_V1",
  generatedAt: new Date().toISOString(),

  candidates: unique.length,

  evidence_tier: "C_BROWSER_VERIFIED",
  data_completeness: "FIXTURE_ONLY",

  predictionGenerated: false,
  oddsGenerated: false,
  resultGenerated: false,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  fixtures: unique
};

const audit = {
  contract:
    "CFI_BROWSER_FIXTURE_COLLECTOR_AUDIT_V1",

  generatedAt: new Date().toISOString(),

  status:
    rejected.length === 0
      ? "PASS"
      : "PASS_WITH_REJECTIONS",

  inputFile,

  inputCandidates: raw.length,
  acceptedBeforeDedup: accepted.length,
  uniqueCandidates: unique.length,
  duplicatesRemoved: duplicates.length,
  rejectedCandidates: rejected.length,

  coverage,

  safeguards: {
    prospectiveOnly: true,
    requireHttpsProvenance: true,
    inferMissingFixture: false,
    generateOdds: false,
    generatePrediction: false,
    generateResult: false,
    fuzzyCanonicalization: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  rejected
};

await saveJson(OUTPUT, manifest);
await saveJson(AUDIT_OUTPUT, audit);

console.log({
  status: audit.status,
  inputCandidates: audit.inputCandidates,
  acceptedBeforeDedup: audit.acceptedBeforeDedup,
  uniqueCandidates: audit.uniqueCandidates,
  duplicatesRemoved: audit.duplicatesRemoved,
  rejectedCandidates: audit.rejectedCandidates,
  coverage: audit.coverage,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
});
