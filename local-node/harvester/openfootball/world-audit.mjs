import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  join,
  relative,
  resolve
} from "node:path";

const ROOT = resolve(
  "local-node/cache/openfootball/openfootball-world"
);

const OUTPUT = resolve(
  "local-node/cache/openfootball/world-coverage-audit.json"
);

async function saveJson(path, value) {
  await mkdir(dirname(path), {
    recursive: true
  });

  await writeFile(
    path,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

async function collectTxtFiles(dir) {
  const files = [];

  for (const entry of await readdir(dir, {
    withFileTypes: true
  })) {
    if (entry.name === ".git") continue;

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...await collectTxtFiles(path)
      );
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".txt")
    ) {
      files.push(path);
    }
  }

  return files;
}

function classifyFile(stats) {
  const {
    matchRows,
    htFtRows,
    ftOnlyRows,
    fixtureOnlyRows
  } = stats;

  if (matchRows === 0) {
    return "NO_MATCH_ROWS";
  }

  if (
    htFtRows > 0 &&
    ftOnlyRows === 0 &&
    fixtureOnlyRows === 0
  ) {
    return "HT_FT_COMPLETE";
  }

  if (htFtRows > 0) {
    return "MIXED_HT_FT";
  }

  if (
    ftOnlyRows > 0 &&
    fixtureOnlyRows > 0
  ) {
    return "FT_AND_FIXTURE";
  }

  if (ftOnlyRows > 0) {
    return "FT_ONLY";
  }

  if (fixtureOnlyRows > 0) {
    return "FIXTURE_ONLY";
  }

  return "UNCLASSIFIED";
}

function plus(target, key, amount = 1) {
  target[key] =
    (target[key] ?? 0) + amount;
}

console.log(
  "CFI OPENFOOTBALL WORLD COVERAGE AUDIT"
);

console.log("MODE: READ_ONLY");
console.log("");

const files = (
  await collectTxtFiles(ROOT)
).sort();

const fileAudit = [];

let totalMatchRows = 0;
let totalHtFtRows = 0;
let totalFtOnlyRows = 0;
let totalFixtureOnlyRows = 0;
let totalImpossibleHtGtFt = 0;

const regionSummary = {};
const classSummary = {};

for (const file of files) {
  const text = await readFile(file, "utf8");

  const rel = relative(ROOT, file)
    .replaceAll("\\", "/");

  const parts = rel.split("/");

  const region =
    parts.length > 1
      ? parts[0]
      : "root";

  const datasetGroup =
    parts.length > 2
      ? parts[1]
      : "unknown";

  let matchRows = 0;
  let htFtRows = 0;
  let ftOnlyRows = 0;
  let fixtureOnlyRows = 0;
  let impossibleHtGtFt = 0;

  for (
    const rawLine of text.split(/\r?\n/)
  ) {
    const line = rawLine.trim();

    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("=") ||
      line.startsWith("▪")
    ) {
      continue;
    }

    /*
      Football.TXT match rows contain
      home team " v " away team.

      Only inspect score text AFTER " v "
      so dates such as 2025-06-01 are not
      mistaken for football scores.
    */
    const separator =
      line.match(/\s+v\s+/i);

    if (!separator) continue;

    matchRows++;

    const splitIndex =
      separator.index +
      separator[0].length;

    const afterV =
      line.slice(splitIndex);

    /*
      Examples:

      Team A v Team B  2-1 (1-0)
                    => HT_FT

      Team A v Team B  0-0
                    => FT_ONLY

      Team A v Team B
                    => FIXTURE_ONLY
    */

    const htFt =
      afterV.match(
        /\b(\d+)-(\d+)\s*\((\d+)-(\d+)\)/
      );

    if (htFt) {
      const ftHome = Number(htFt[1]);
      const ftAway = Number(htFt[2]);

      const htHome = Number(htFt[3]);
      const htAway = Number(htFt[4]);

      htFtRows++;

      if (
        htHome > ftHome ||
        htAway > ftAway
      ) {
        impossibleHtGtFt++;
      }

      continue;
    }

    const ft =
      afterV.match(
        /\b(\d+)-(\d+)\b/
      );

    if (ft) {
      ftOnlyRows++;
      continue;
    }

    fixtureOnlyRows++;
  }

  const dataClass = classifyFile({
    matchRows,
    htFtRows,
    ftOnlyRows,
    fixtureOnlyRows
  });

  totalMatchRows += matchRows;
  totalHtFtRows += htFtRows;
  totalFtOnlyRows += ftOnlyRows;
  totalFixtureOnlyRows +=
    fixtureOnlyRows;

  totalImpossibleHtGtFt +=
    impossibleHtGtFt;

  plus(
    classSummary,
    dataClass
  );

  if (!regionSummary[region]) {
    regionSummary[region] = {
      files: 0,
      matchRows: 0,
      htFtRows: 0,
      ftOnlyRows: 0,
      fixtureOnlyRows: 0,
      impossibleHtGtFt: 0,
      datasetGroups: new Set()
    };
  }

  const r = regionSummary[region];

  r.files++;
  r.matchRows += matchRows;
  r.htFtRows += htFtRows;
  r.ftOnlyRows += ftOnlyRows;
  r.fixtureOnlyRows +=
    fixtureOnlyRows;

  r.impossibleHtGtFt +=
    impossibleHtGtFt;

  r.datasetGroups.add(datasetGroup);

  fileAudit.push({
    file: rel,
    region,
    datasetGroup,
    dataClass,

    matchRows,
    htFtRows,
    ftOnlyRows,
    fixtureOnlyRows,

    impossibleHtGtFt,

    htFtPrimaryEligible:
      htFtRows > 0 &&
      impossibleHtGtFt === 0,

    ftOnlyAuxiliaryEligible:
      ftOnlyRows > 0,

    fixtureDiscoveryEligible:
      fixtureOnlyRows > 0
  });
}

const normalizedRegions =
  Object.fromEntries(
    Object.entries(regionSummary)
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(([region, r]) => [
        region,
        {
          files: r.files,

          datasetGroups:
            [...r.datasetGroups].sort(),

          matchRows:
            r.matchRows,

          htFtRows:
            r.htFtRows,

          ftOnlyRows:
            r.ftOnlyRows,

          fixtureOnlyRows:
            r.fixtureOnlyRows,

          impossibleHtGtFt:
            r.impossibleHtGtFt
        }
      ])
  );

const hardBlockers = [];

if (files.length === 0) {
  hardBlockers.push(
    "OPENFOOTBALL_WORLD_EMPTY"
  );
}

if (totalImpossibleHtGtFt > 0) {
  hardBlockers.push(
    "IMPOSSIBLE_HT_GT_FT"
  );
}

/*
  Important:
  We do NOT require every row/file
  to contain HT.

  Missing HT is a DATA CLASS,
  not an excuse to invent HT 0-0.
*/

const audit = {
  contract:
    "CFI_OPENFOOTBALL_WORLD_COVERAGE_AUDIT_V1",

  generatedAt:
    new Date().toISOString(),

  status:
    hardBlockers.length === 0
      ? "PASS"
      : "FAIL",

  hardBlockers,

  filesScanned:
    files.length,

  matchRows:
    totalMatchRows,

  evidenceClasses: {
    HT_FT: {
      rows: totalHtFtRows,
      intendedUse:
        "HT_FT_PRIMARY_CANDIDATE"
    },

    FT_ONLY: {
      rows: totalFtOnlyRows,
      intendedUse:
        "FT_ONLY_AUXILIARY"
    },

    FIXTURE_ONLY: {
      rows: totalFixtureOnlyRows,
      intendedUse:
        "FIXTURE_DISCOVERY_ONLY"
    }
  },

  impossibleHtGtFt:
    totalImpossibleHtGtFt,

  fileClassSummary:
    classSummary,

  regionCoverage:
    normalizedRegions,

  policy: {
    inferMissingHtAsZero: false,

    promoteFtOnlyToHtFt:
      false,

    ambiguousDataFailsClosed:
      true,

    bigDbWriteAllowed:
      false
  },

  bigDbWriteAttempted:
    false,

  files:
    fileAudit
};

await saveJson(OUTPUT, audit);

console.log({
  status: audit.status,

  hardBlockers:
    audit.hardBlockers,

  filesScanned:
    audit.filesScanned,

  matchRows:
    audit.matchRows,

  htFtRows:
    audit.evidenceClasses
      .HT_FT.rows,

  ftOnlyRows:
    audit.evidenceClasses
      .FT_ONLY.rows,

  fixtureOnlyRows:
    audit.evidenceClasses
      .FIXTURE_ONLY.rows,

  impossibleHtGtFt:
    audit.impossibleHtGtFt,

  fileClassSummary:
    audit.fileClassSummary,

  regions:
    Object.keys(
      audit.regionCoverage
    ),

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false
});

console.log("");

console.log(
  `Audit written to: ${OUTPUT}`
);
