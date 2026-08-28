import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const FILES = {
  footballData: resolve("local-node/cache/football-data-prospective.json"),
  browser: resolve("local-node/cache/browser/fixture-candidates.json"),
  cross: resolve("local-node/cache/browser/cross-source-fixture-verification.json"),
  aliases: resolve("local-node/cache/openfootball/club-alias-manifest.json"),

  output: resolve("local-node/cache/canonical/prospective-fixtures.json"),
  audit: resolve("local-node/cache/canonical/canonical-merge-audit.json")
};

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/\(([a-z]{2,4})\)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hash(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

const footballData = await readJson(FILES.footballData);
const browser = await readJson(FILES.browser);
const cross = await readJson(FILES.cross);
const aliasesManifest = await readJson(FILES.aliases);

const ambiguousAliases = new Set(
  (aliasesManifest.collisions ?? [])
    .map(x => normalizeText(x.alias_normalized))
    .filter(Boolean)
);

const aliasBuckets = new Map();

for (const row of aliasesManifest.aliases ?? []) {
  const key = normalizeText(row.alias_normalized ?? row.alias);

  if (!key) {
    continue;
  }

  if (!aliasBuckets.has(key)) {
    aliasBuckets.set(key, []);
  }

  aliasBuckets.get(key).push(row);
}

const uniqueAliasMap = new Map();

for (const [key, rows] of aliasBuckets.entries()) {
  const canonicalNames = [
    ...new Set(
      rows
        .map(x => String(x.canonical_name ?? "").trim())
        .filter(Boolean)
    )
  ];

  if (
    canonicalNames.length === 1 &&
    !ambiguousAliases.has(key)
  ) {
    uniqueAliasMap.set(key, {
      canonical_name: canonicalNames[0],
      records: rows
    });
  }
}

function resolveTeamIdentity(rawName) {
  const normalized = normalizeText(rawName);

  if (!normalized) {
    return {
      raw_name: rawName,
      normalized: "",
      identity_key: "",
      alias_status: "INVALID_EMPTY"
    };
  }

  if (ambiguousAliases.has(normalized)) {
    return {
      raw_name: rawName,
      normalized,
      canonical_name: rawName,
      canonical_normalized: normalized,
      identity_key: normalized,
      alias_status: "AMBIGUOUS_FAIL_CLOSED"
    };
  }

  const bridge = uniqueAliasMap.get(normalized);

  if (bridge) {
    const canonicalNormalized =
      normalizeText(bridge.canonical_name);

    return {
      raw_name: rawName,
      normalized,
      canonical_name: bridge.canonical_name,
      canonical_normalized: canonicalNormalized,
      identity_key: canonicalNormalized,
      alias_status: "OPENFOOTBALL_EXACT_UNIQUE",
      alias_source: "openfootball-clubs"
    };
  }

  return {
    raw_name: rawName,
    normalized,
    canonical_name: rawName,
    canonical_normalized: normalized,
    identity_key: normalized,
    alias_status: "NO_EXACT_ALIAS"
  };
}

function sourceFixtureKey(sourceId, home, away, kickoff) {
  return [
    String(sourceId ?? ""),
    normalizeText(home),
    normalizeText(away),
    String(kickoff ?? "")
  ].join("|");
}

const overlay = new Map();

function setOverlay(record, status) {
  if (!record?.soccerway) {
    return;
  }

  const key = sourceFixtureKey(
    record.soccerway.source_id,
    record.soccerway.home_team,
    record.soccerway.away_team,
    record.soccerway.kickoff_utc
  );

  const priority = {
    CROSS_VERIFIED_STRONG: 20,
    CROSS_VERIFIED_TIME_DISAGREEMENT: 30,
    CONFLICT_FAIL_CLOSED: 100
  };

  const existing = overlay.get(key);

  if (
    !existing ||
    priority[status] > priority[existing.status]
  ) {
    overlay.set(key, {
      status,
      evidence: record
    });
  }
}

for (const record of cross.crossVerifiedStrong ?? []) {
  setOverlay(record, "CROSS_VERIFIED_STRONG");
}

for (const record of cross.crossVerifiedTimeDisagreement ?? []) {
  setOverlay(
    record,
    "CROSS_VERIFIED_TIME_DISAGREEMENT"
  );
}

for (const record of cross.conflicts ?? []) {
  setOverlay(record, "CONFLICT_FAIL_CLOSED");
}

function normalizeCandidate(candidate, origin) {
  const home =
    candidate.home_team ??
    candidate.homeTeam ??
    candidate.home ??
    null;

  const away =
    candidate.away_team ??
    candidate.awayTeam ??
    candidate.away ??
    null;

  const kickoff =
    candidate.kickoff_utc ??
    candidate.kickoffUtc ??
    candidate.kickoff ??
    null;

  const sourceId =
    candidate.source_id ??
    candidate.source ??
    origin;

  if (!home || !away || !kickoff) {
    return {
      valid: false,
      reason: "MISSING_REQUIRED_FIELD",
      origin,
      candidate
    };
  }

  const kickoffMs = new Date(kickoff).getTime();

  if (!Number.isFinite(kickoffMs)) {
    return {
      valid: false,
      reason: "INVALID_KICKOFF",
      origin,
      candidate
    };
  }

  if (kickoffMs <= Date.now()) {
    return {
      valid: false,
      reason: "NOT_PROSPECTIVE",
      origin,
      candidate
    };
  }

  const homeIdentity = resolveTeamIdentity(home);
  const awayIdentity = resolveTeamIdentity(away);

  const sourceKey = sourceFixtureKey(
    sourceId,
    home,
    away,
    kickoff
  );

  const crossOverlay = overlay.get(sourceKey) ?? null;

  let verificationStatus =
    crossOverlay?.status ?? "SINGLE_SOURCE";

  const identityFailClosed =
    homeIdentity.alias_status === "AMBIGUOUS_FAIL_CLOSED" ||
    awayIdentity.alias_status === "AMBIGUOUS_FAIL_CLOSED";

  if (identityFailClosed) {
    verificationStatus = "IDENTITY_AMBIGUOUS_FAIL_CLOSED";
  }

  return {
    valid: true,

    origin,
    source_id: sourceId,
    source_url: candidate.source_url ?? null,
    provider_id: candidate.provider_id ?? null,

    competition: candidate.competition ?? null,
    country: candidate.country ?? null,

    home_team: home,
    away_team: away,
    kickoff_utc: new Date(kickoffMs).toISOString(),

    gender: candidate.gender ?? "UNKNOWN",
    age_band: candidate.age_band ?? "UNKNOWN",
    competition_class:
      candidate.competition_class ?? "UNKNOWN",

    evidence_tier:
      candidate.evidence_tier ?? null,

    data_completeness:
      candidate.data_completeness ?? "FIXTURE_ONLY",

    home_identity: homeIdentity,
    away_identity: awayIdentity,

    verification_status: verificationStatus,
    cross_source_evidence:
      crossOverlay?.evidence ?? null,

    decisionUse: false
  };
}

const rawCandidates = [];

for (const candidate of footballData.candidates ?? []) {
  rawCandidates.push({
    origin: "FOOTBALL_DATA",
    candidate
  });
}

for (const candidate of browser.fixtures ?? []) {
  rawCandidates.push({
    origin: "BROWSER",
    candidate
  });
}

const accepted = [];
const rejected = [];

for (const item of rawCandidates) {
  const normalized = normalizeCandidate(
    item.candidate,
    item.origin
  );

  if (normalized.valid) {
    accepted.push(normalized);
  } else {
    rejected.push(normalized);
  }
}

function canonicalFixtureIdentity(fixture) {
  return [
    fixture.home_identity.identity_key,
    fixture.away_identity.identity_key,
    fixture.kickoff_utc
  ].join("|");
}

function provenanceKey(p) {
  return [
    p.source_id,
    normalizeText(p.home_team),
    normalizeText(p.away_team),
    p.kickoff_utc
  ].join("|");
}

function verificationPriority(status) {
  return {
    CONFLICT_FAIL_CLOSED: 100,
    IDENTITY_AMBIGUOUS_FAIL_CLOSED: 95,
    CROSS_VERIFIED_STRONG: 80,
    CROSS_VERIFIED_TIME_DISAGREEMENT: 70,
    MULTI_SOURCE_EXACT: 60,
    SINGLE_SOURCE: 50
  }[status] ?? 0;
}

const exactGroups = new Map();

for (const fixture of accepted) {
  const key = canonicalFixtureIdentity(fixture);

  if (!exactGroups.has(key)) {
    exactGroups.set(key, []);
  }

  exactGroups.get(key).push(fixture);
}

const canonicalFixtures = [];

for (const [identity, group] of exactGroups.entries()) {
  const first = group[0];

  const provenanceMap = new Map();

  for (const fixture of group) {
    const baseProvenance = {
      source_id: fixture.source_id,
      source_url: fixture.source_url,
      provider_id: fixture.provider_id,
      origin: fixture.origin,
      home_team: fixture.home_team,
      away_team: fixture.away_team,
      kickoff_utc: fixture.kickoff_utc
    };

    provenanceMap.set(
      provenanceKey(baseProvenance),
      baseProvenance
    );

    const evidence = fixture.cross_source_evidence;

    if (evidence?.soccerway) {
      const p = {
        ...evidence.soccerway,
        origin: "CROSS_SOURCE_EVIDENCE"
      };

      provenanceMap.set(
        provenanceKey(p),
        p
      );
    }

    if (evidence?.sofascore) {
      const p = {
        ...evidence.sofascore,
        origin: "CROSS_SOURCE_EVIDENCE"
      };

      provenanceMap.set(
        provenanceKey(p),
        p
      );
    }
  }

  const statuses = group.map(
    x => x.verification_status
  );

  let finalStatus = statuses
    .slice()
    .sort(
      (a, b) =>
        verificationPriority(b) -
        verificationPriority(a)
    )[0];

  const distinctSources = new Set(
    [...provenanceMap.values()]
      .map(x => x.source_id)
      .filter(Boolean)
  );

  if (
    finalStatus === "SINGLE_SOURCE" &&
    distinctSources.size > 1
  ) {
    finalStatus = "MULTI_SOURCE_EXACT";
  }

  canonicalFixtures.push({
    contract: "CFI_CANONICAL_FIXTURE_V1",

    canonical_fixture_id: hash(identity),

    canonical_home_key:
      first.home_identity.identity_key,

    canonical_away_key:
      first.away_identity.identity_key,

    home_team: first.home_team,
    away_team: first.away_team,
    kickoff_utc: first.kickoff_utc,

    competition: first.competition,
    country: first.country,

    gender: first.gender,
    age_band: first.age_band,
    competition_class:
      first.competition_class,

    home_identity:
      first.home_identity,

    away_identity:
      first.away_identity,

    verification_status:
      finalStatus,

    source_count:
      distinctSources.size,

    provenance:
      [...provenanceMap.values()],

    decisionUse: false,
    bigDbWriteEligible: false
  });
}

const sameTeamDateGroups = new Map();

for (const fixture of canonicalFixtures) {
  const date = fixture.kickoff_utc.slice(0, 10);

  const key = [
    fixture.canonical_home_key,
    fixture.canonical_away_key,
    date
  ].join("|");

  if (!sameTeamDateGroups.has(key)) {
    sameTeamDateGroups.set(key, []);
  }

  sameTeamDateGroups.get(key).push(fixture);
}

const intrinsicKickoffConflicts = [];

for (const [key, fixtures] of sameTeamDateGroups.entries()) {
  const kickoffs = [
    ...new Set(
      fixtures.map(x => x.kickoff_utc)
    )
  ];

  if (kickoffs.length > 1) {
    intrinsicKickoffConflicts.push({
      conflict_type:
        "SAME_TEAMS_DATE_MULTIPLE_KICKOFFS",

      identity: key,
      kickoffs,
      canonical_fixture_ids:
        fixtures.map(
          x => x.canonical_fixture_id
        ),

      decisionUse: false
    });

    for (const fixture of fixtures) {
      fixture.verification_status =
        "CONFLICT_FAIL_CLOSED";

      fixture.bigDbWriteEligible = false;
    }
  }
}

const crossProviderConflicts =
  (cross.conflicts ?? []).map(x => ({
    conflict_type:
      "CROSS_PROVIDER_KICKOFF_CONFLICT",

    cohort: x.cohort,

    canonicalHome:
      x.canonicalHome,

    canonicalAway:
      x.canonicalAway,

    kickoffDifferenceMinutes:
      x.kickoffDifferenceMinutes,

    soccerway:
      x.soccerway,

    sofascore:
      x.sofascore,

    decisionUse: false
  }));

const statusCounts = {};

for (const fixture of canonicalFixtures) {
  statusCounts[fixture.verification_status] =
    (statusCounts[fixture.verification_status] ?? 0) + 1;
}

const identityAmbiguousFixtures =
  canonicalFixtures.filter(
    x =>
      x.home_identity.alias_status ===
        "AMBIGUOUS_FAIL_CLOSED" ||
      x.away_identity.alias_status ===
        "AMBIGUOUS_FAIL_CLOSED"
  );

const output = {
  contract:
    "CFI_CANONICAL_FIXTURE_MERGE_V1",

  generatedAt:
    new Date().toISOString(),

  policy: {
    prospectiveOnly: true,
    openFootballAliasMode:
      "EXACT_UNIQUE_ONLY",
    ambiguousAliasPolicy:
      "FAIL_CLOSED",
    fuzzyMatching: false,
    automaticKickoffCorrection: false,
    averageProviderKickoff: false,
    conflictPriorityOverSingleSource: true,
    decisionUse: false
  },

  fixtures:
    canonicalFixtures,

  conflictLedger: {
    crossProvider:
      crossProviderConflicts,

    intrinsicSameTeamDate:
      intrinsicKickoffConflicts
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

const audit = {
  contract:
    "CFI_CANONICAL_FIXTURE_MERGE_AUDIT_V1",

  generatedAt:
    new Date().toISOString(),

  status:
    crossProviderConflicts.length > 0 ||
    intrinsicKickoffConflicts.length > 0 ||
    identityAmbiguousFixtures.length > 0
      ? "PASS_WITH_FAIL_CLOSED_ITEMS"
      : "PASS",

  inputs: {
    footballDataProspective:
      footballData.candidates?.length ?? 0,

    browserProspective:
      browser.fixtures?.length ?? 0,

    crossVerifiedStrong:
      cross.crossVerifiedStrong?.length ?? 0,

    crossVerifiedTimeDisagreement:
      cross.crossVerifiedTimeDisagreement?.length ?? 0,

    crossProviderConflicts:
      cross.conflicts?.length ?? 0,

    openFootballAliases:
      aliasesManifest.aliases?.length ?? 0,

    openFootballAmbiguousAliasKeys:
      aliasesManifest.ambiguousAliasKeys ?? null
  },

  candidateRows:
    rawCandidates.length,

  acceptedProspectiveRows:
    accepted.length,

  rejectedRows:
    rejected.length,

  canonicalFixtures:
    canonicalFixtures.length,

  exactDuplicatesRemoved:
    accepted.length - canonicalFixtures.length,

  identityAmbiguousFixtures:
    identityAmbiguousFixtures.length,

  intrinsicSameTeamDateKickoffConflicts:
    intrinsicKickoffConflicts.length,

  crossProviderConflicts:
    crossProviderConflicts.length,

  verificationStatus:
    statusCounts,

  safeguards: {
    historicalRowsPromotedAsProspective: false,
    fuzzyMatching: false,
    automaticKickoffCorrection: false,
    ambiguousAliasPromotion: false,
    conflictPromotion: false,
    decisionUse: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  rejected
};

await saveJson(FILES.output, output);
await saveJson(FILES.audit, audit);

console.log("CFI CANONICAL MERGE SUMMARY");
console.dir({
  status: audit.status,
  candidateRows: audit.candidateRows,
  acceptedProspectiveRows:
    audit.acceptedProspectiveRows,
  rejectedRows: audit.rejectedRows,
  canonicalFixtures:
    audit.canonicalFixtures,
  exactDuplicatesRemoved:
    audit.exactDuplicatesRemoved,
  identityAmbiguousFixtures:
    audit.identityAmbiguousFixtures,
  intrinsicSameTeamDateKickoffConflicts:
    audit.intrinsicSameTeamDateKickoffConflicts,
  crossProviderConflicts:
    audit.crossProviderConflicts,
  verificationStatus:
    audit.verificationStatus,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
}, { depth: null });
