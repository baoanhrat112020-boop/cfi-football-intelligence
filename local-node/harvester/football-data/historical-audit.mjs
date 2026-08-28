import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";

const MANIFEST = resolve(
  "local-node/cache/historical/football-data/manifest.json"
);

const NORMALIZED_DIR = resolve(
  "local-node/cache/historical/football-data/normalized"
);

const AUDIT_OUTPUT = resolve(
  "local-node/cache/historical/football-data/corpus-audit.json"
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

function validInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function fixtureSignature(row) {
  return JSON.stringify({
    competition: row.competition,
    date: row.date,
    home_team: row.home_team,
    away_team: row.away_team,
    ht_home: row.ht_home,
    ht_away: row.ht_away,
    ft_home: row.ft_home,
    ft_away: row.ft_away
  });
}

function rate(n, d) {
  return d > 0 ? Number((n / d).toFixed(6)) : 0;
}

console.log("CFI HISTORICAL CORPUS AUDIT");
console.log("MODE: READ_ONLY");
console.log("");

const manifest = await readJson(MANIFEST);

const files = (await readdir(NORMALIZED_DIR))
  .filter(x => x.endsWith(".json"))
  .sort();

const rawRows = [];

for (const file of files) {
  const doc = await readJson(join(NORMALIZED_DIR, file));

  for (const fixture of doc.fixtures ?? []) {
    rawRows.push({
      ...fixture,
      audit_source_file: file
    });
  }
}

/* ---------------------------
   SOURCE COVERAGE
--------------------------- */

const sourceResults = manifest.sourceResults ?? [];

const successfulStatuses = new Set([
  "CHANGED",
  "UNCHANGED_304",
  "UNCHANGED_SHA256"
]);

const failedSources = sourceResults.filter(
  x => !successfulStatuses.has(x.status)
);

const sourceCoverageBySeason = {};

for (const row of rawRows) {
  const season = row.season ?? "UNKNOWN";

  if (!sourceCoverageBySeason[season]) {
    sourceCoverageBySeason[season] = {
      rows: 0,
      competitions: new Set()
    };
  }

  sourceCoverageBySeason[season].rows++;
  sourceCoverageBySeason[season].competitions.add(
    row.competition ?? "UNKNOWN"
  );
}

const seasonCoverage = Object.fromEntries(
  Object.entries(sourceCoverageBySeason)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, value]) => [
      season,
      {
        rows: value.rows,
        competitions: value.competitions.size,
        competitionCodes: [...value.competitions].sort()
      }
    ])
);

/* ---------------------------
   FIELD + SCORE SANITY
--------------------------- */

const missingRequired = [];
const invalidScores = [];
const htGtFt = [];
const futureRows = [];

const today = new Date();
today.setUTCHours(23, 59, 59, 999);

for (const row of rawRows) {
  const required = [
    "identity_key",
    "season",
    "competition",
    "date",
    "home_team",
    "away_team"
  ];

  const missing = required.filter(
    field =>
      row[field] === undefined ||
      row[field] === null ||
      String(row[field]).trim() === ""
  );

  if (missing.length) {
    missingRequired.push({
      identity_key: row.identity_key ?? null,
      source_id: row.source_id ?? null,
      missing
    });
  }

  const scores = [
    row.ht_home,
    row.ht_away,
    row.ft_home,
    row.ft_away
  ];

  if (!scores.every(validInteger)) {
    invalidScores.push({
      identity_key: row.identity_key,
      source_id: row.source_id,
      scores
    });

    continue;
  }

  if (
    row.ht_home > row.ft_home ||
    row.ht_away > row.ft_away
  ) {
    htGtFt.push({
      identity_key: row.identity_key,
      match: `${row.home_team} vs ${row.away_team}`,
      date: row.date,
      ht: `${row.ht_home}-${row.ht_away}`,
      ft: `${row.ft_home}-${row.ft_away}`
    });
  }

  const date = new Date(`${row.date}T23:59:59Z`);

  if (
    Number.isFinite(date.getTime()) &&
    date.getTime() > today.getTime()
  ) {
    futureRows.push({
      identity_key: row.identity_key,
      source_id: row.source_id,
      date: row.date,
      match: `${row.home_team} vs ${row.away_team}`,
      ht: `${row.ht_home}-${row.ht_away}`,
      ft: `${row.ft_home}-${row.ft_away}`
    });
  }
}

/* ---------------------------
   DUPLICATE + COLLISION AUDIT
--------------------------- */

const byIdentity = new Map();

for (const row of rawRows) {
  if (!row.identity_key) continue;

  if (!byIdentity.has(row.identity_key)) {
    byIdentity.set(row.identity_key, []);
  }

  byIdentity.get(row.identity_key).push(row);
}

let exactDuplicates = 0;
const identityConflicts = [];

for (const [identityKey, rows] of byIdentity) {
  if (rows.length <= 1) continue;

  const signatures = new Set(
    rows.map(fixtureSignature)
  );

  if (signatures.size === 1) {
    exactDuplicates += rows.length - 1;
  } else {
    identityConflicts.push({
      identity_key: identityKey,
      occurrences: rows.length,
      fixtures: rows.map(row => ({
        source_id: row.source_id,
        season: row.season,
        competition: row.competition,
        date: row.date,
        home_team: row.home_team,
        away_team: row.away_team,
        ht: `${row.ht_home}-${row.ht_away}`,
        ft: `${row.ft_home}-${row.ft_away}`
      }))
    });
  }
}

/* ---------------------------
   CFI EVENT COVERAGE
--------------------------- */

const validRows = rawRows.filter(row =>
  [
    row.ht_home,
    row.ht_away,
    row.ft_home,
    row.ft_away
  ].every(validInteger)
);

let event3PlusHt = 0;
let event7PlusFt = 0;
let eventOtherHtProxy = 0;
let eventOtherFtProxy = 0;

for (const row of validRows) {
  const htTotal = row.ht_home + row.ht_away;
  const ftTotal = row.ft_home + row.ft_away;

  if (htTotal >= 3) {
    event3PlusHt++;
  }

  if (ftTotal >= 7) {
    event7PlusFt++;
  }

  // CFI operational event proxies used only for corpus coverage audit.
  if (
    row.ht_home >= 4 ||
    row.ht_away >= 4
  ) {
    eventOtherHtProxy++;
  }

  if (
    row.ft_home >= 5 ||
    row.ft_away >= 5
  ) {
    eventOtherFtProxy++;
  }
}

const eventCoverage = {
  validFixtures: validRows.length,

  "3+HT": {
    count: event3PlusHt,
    rate: rate(event3PlusHt, validRows.length)
  },

  "7+FT": {
    count: event7PlusFt,
    rate: rate(event7PlusFt, validRows.length)
  },

  otherHTOperationalProxy: {
    definition: "one team scores >=4 HT",
    count: eventOtherHtProxy,
    rate: rate(eventOtherHtProxy, validRows.length)
  },

  otherFTOperationalProxy: {
    definition: "one team scores >=5 FT",
    count: eventOtherFtProxy,
    rate: rate(eventOtherFtProxy, validRows.length)
  }
};

/* ---------------------------
   LEAGUE COVERAGE
--------------------------- */

const leagueMap = new Map();

for (const row of validRows) {
  const key =
    `${row.season}|${row.competition}|${row.league ?? ""}`;

  if (!leagueMap.has(key)) {
    leagueMap.set(key, {
      season: row.season,
      competition: row.competition,
      league: row.league ?? null,
      rows: 0,
      minDate: null,
      maxDate: null
    });
  }

  const item = leagueMap.get(key);

  item.rows++;

  if (!item.minDate || row.date < item.minDate) {
    item.minDate = row.date;
  }

  if (!item.maxDate || row.date > item.maxDate) {
    item.maxDate = row.date;
  }
}

const leagueCoverage = [...leagueMap.values()]
  .sort((a, b) =>
    `${a.season}-${a.competition}`
      .localeCompare(`${b.season}-${b.competition}`)
  );

/* ---------------------------
   DECISION
--------------------------- */

const hardBlockers = [];

if (rawRows.length === 0) {
  hardBlockers.push("EMPTY_CORPUS");
}

if (missingRequired.length > 0) {
  hardBlockers.push("MISSING_REQUIRED_FIELDS");
}

if (invalidScores.length > 0) {
  hardBlockers.push("INVALID_SCORE_VALUES");
}

if (htGtFt.length > 0) {
  hardBlockers.push("IMPOSSIBLE_HT_GT_FT_SCORE");
}

if (futureRows.length > 0) {
  hardBlockers.push("FUTURE_RESULT_LEAKAGE");
}

if (identityConflicts.length > 0) {
  hardBlockers.push("IDENTITY_SCORE_COLLISION");
}

const warnings = [];

if (failedSources.length > 0) {
  warnings.push("SOURCE_COVERAGE_GAPS");
}

if (
  manifest.uniqueRows !== undefined &&
  manifest.uniqueRows !== byIdentity.size
) {
  warnings.push("MANIFEST_UNIQUE_COUNT_MISMATCH");
}

const status =
  hardBlockers.length > 0
    ? "FAIL"
    : warnings.length > 0
      ? "PASS_WITH_WARNINGS"
      : "PASS";

const audit = {
  contract: "CFI_HISTORICAL_CORPUS_AUDIT_V1",
  generatedAt: new Date().toISOString(),

  status,
  hardBlockers,
  warnings,

  sourceAudit: {
    configured: manifest.sourcesConfigured ?? null,
    successful: manifest.sourcesSuccessful ?? null,
    failed: failedSources.length,
    failedSources
  },

  corpus: {
    normalizedFilesScanned: files.length,
    collectedRowsFromFiles: rawRows.length,
    uniqueIdentityKeys: byIdentity.size,
    exactDuplicates,
    identityConflicts: identityConflicts.length,

    missingRequiredFields: missingRequired.length,
    invalidScores: invalidScores.length,
    impossibleHtGtFt: htGtFt.length,
    futureResultRows: futureRows.length
  },

  seasonCoverage,
  leagueCoverage,
  eventCoverage,

  diagnostics: {
    missingRequired,
    invalidScores,
    htGtFt,
    futureRows,
    identityConflicts
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

await saveJson(AUDIT_OUTPUT, audit);

console.log({
  status: audit.status,
  hardBlockers: audit.hardBlockers,
  warnings: audit.warnings,

  sourcesConfigured: audit.sourceAudit.configured,
  sourcesSuccessful: audit.sourceAudit.successful,
  sourcesFailed: audit.sourceAudit.failed,

  normalizedFilesScanned:
    audit.corpus.normalizedFilesScanned,

  collectedRows:
    audit.corpus.collectedRowsFromFiles,

  uniqueIdentityKeys:
    audit.corpus.uniqueIdentityKeys,

  exactDuplicates:
    audit.corpus.exactDuplicates,

  identityConflicts:
    audit.corpus.identityConflicts,

  missingRequiredFields:
    audit.corpus.missingRequiredFields,

  invalidScores:
    audit.corpus.invalidScores,

  impossibleHtGtFt:
    audit.corpus.impossibleHtGtFt,

  futureResultRows:
    audit.corpus.futureResultRows,

  eventCoverage:
    audit.eventCoverage,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
});

console.log("");
console.log(`Audit written to: ${AUDIT_OUTPUT}`);
