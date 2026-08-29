import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const INPUT = resolve(
  "local-node/cache/canonical/prospective-fixtures.json"
);

const OUTPUT = resolve(
  "local-node/cache/canonical/bigdb-dry-run.json"
);

const AUDIT = resolve(
  "local-node/cache/canonical/bigdb-dry-run-audit.json"
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

const manifest = JSON.parse(
  await readFile(INPUT, "utf8")
);

const fixtures = Array.isArray(manifest.fixtures)
  ? manifest.fixtures
  : [];

const allowedStatuses = new Set([
  "CROSS_VERIFIED_STRONG",
  "CROSS_VERIFIED_TIME_DISAGREEMENT",
  "SINGLE_SOURCE",
  "MULTI_SOURCE_EXACT"
]);

const dryRunRows = [];
const blockedRows = [];

for (const fixture of fixtures) {
  const reasons = [];

  if (!fixture.canonical_fixture_id) {
    reasons.push("MISSING_CANONICAL_FIXTURE_ID");
  }

  if (!fixture.home_team || !fixture.away_team) {
    reasons.push("MISSING_TEAM");
  }

  if (!fixture.kickoff_utc) {
    reasons.push("MISSING_KICKOFF");
  }

  if (
    !Number.isFinite(
      new Date(fixture.kickoff_utc).getTime()
    )
  ) {
    reasons.push("INVALID_KICKOFF");
  }

  if (
    new Date(fixture.kickoff_utc).getTime() <= Date.now()
  ) {
    reasons.push("NOT_PROSPECTIVE");
  }

  if (
    fixture.verification_status ===
    "CONFLICT_FAIL_CLOSED"
  ) {
    reasons.push("CONFLICT_FAIL_CLOSED");
  }

  if (
    fixture.verification_status ===
    "IDENTITY_AMBIGUOUS_FAIL_CLOSED"
  ) {
    reasons.push("IDENTITY_AMBIGUOUS_FAIL_CLOSED");
  }

  if (
    !allowedStatuses.has(
      fixture.verification_status
    ) &&
    reasons.length === 0
  ) {
    reasons.push("UNSUPPORTED_VERIFICATION_STATUS");
  }

  const row = {
    canonical_fixture_id:
      fixture.canonical_fixture_id,

    home_team:
      fixture.home_team,

    away_team:
      fixture.away_team,

    kickoff_utc:
      fixture.kickoff_utc,

    competition:
      fixture.competition,

    country:
      fixture.country,

    gender:
      fixture.gender,

    age_band:
      fixture.age_band,

    competition_class:
      fixture.competition_class,

    verification_status:
      fixture.verification_status,

    source_count:
      fixture.source_count,

    provenance:
      fixture.provenance,

    data_completeness:
      "FIXTURE_ONLY",

    predictionGenerated: false,
    oddsGenerated: false,
    resultGenerated: false,
    decisionUse: false
  };

  if (reasons.length > 0) {
    blockedRows.push({
      ...row,
      blocked_reasons: reasons
    });
  } else {
    dryRunRows.push(row);
  }
}

const duplicateIds = [];

const seen = new Set();

for (const row of dryRunRows) {
  if (seen.has(row.canonical_fixture_id)) {
    duplicateIds.push(
      row.canonical_fixture_id
    );
  }

  seen.add(row.canonical_fixture_id);
}

const statusCounts = {};

for (const row of dryRunRows) {
  statusCounts[row.verification_status] =
    (statusCounts[row.verification_status] ?? 0) + 1;
}

const blockedReasonCounts = {};

for (const row of blockedRows) {
  for (const reason of row.blocked_reasons) {
    blockedReasonCounts[reason] =
      (blockedReasonCounts[reason] ?? 0) + 1;
  }
}

const output = {
  contract: "CFI_BIGDB_FIXTURE_DRY_RUN_V1",
  generatedAt: new Date().toISOString(),

  mode: "DRY_RUN_ONLY",

  rows: dryRunRows,
  blockedRows,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

const audit = {
  contract: "CFI_BIGDB_FIXTURE_DRY_RUN_AUDIT_V1",
  generatedAt: new Date().toISOString(),

  status:
    duplicateIds.length === 0
      ? "PASS"
      : "FAIL",

  canonicalInputRows:
    fixtures.length,

  eligibleDryRunRows:
    dryRunRows.length,

  blockedRows:
    blockedRows.length,

  duplicateCanonicalIds:
    duplicateIds.length,

  verificationStatus:
    statusCounts,

  blockedReasons:
    blockedReasonCounts,

  safeguards: {
    actualBigDbMutation: false,
    predictionGeneration: false,
    oddsGeneration: false,
    resultGeneration: false,
    conflictPromotion: false,
    ambiguousIdentityPromotion: false,
    decisionUse: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

await saveJson(OUTPUT, output);
await saveJson(AUDIT, audit);

console.log("CFI BIGDB DRY-RUN SUMMARY");

console.dir({
  status: audit.status,
  canonicalInputRows:
    audit.canonicalInputRows,
  eligibleDryRunRows:
    audit.eligibleDryRunRows,
  blockedRows:
    audit.blockedRows,
  duplicateCanonicalIds:
    audit.duplicateCanonicalIds,
  verificationStatus:
    audit.verificationStatus,
  blockedReasons:
    audit.blockedReasons,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
}, { depth: null });
