import { createHash } from "node:crypto";
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
  HISTORICAL_SOURCES
} from "./historical-registry.mjs";

const PARSER_VERSION =
  "CFI_FOOTBALL_DATA_HTFT_STRICT_V2";

const MANIFEST_FILE = resolve(
  "local-node/cache/historical/football-data/manifest.json"
);

function splitCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += c;
    }
  }

  out.push(value);
  return out;
}

function parseScoreField(value) {
  const raw = String(value ?? "").trim();

  // Blank / malformed score MUST NOT become zero.
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const n = Number(raw);

  return Number.isSafeInteger(n) && n >= 0
    ? n
    : null;
}

function normalizeDate(value) {
  const input = String(value ?? "").trim();

  let m = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (m) {
    const [, dd, mm, yyyy] = m;

    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  m = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/
  );

  if (m) {
    const [, dd, mm, yy] = m;

    const yyyy =
      Number(yy) >= 80
        ? `19${yy}`
        : `20${yy}`;

    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  return null;
}

function identity(row) {
  return createHash("sha256")
    .update(
      [
        row.competition,
        row.date,
        row.home_team,
        row.away_team
      ]
        .join("|")
        .toLowerCase()
        .normalize("NFKD")
    )
    .digest("hex");
}

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

function parseSource(source, text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("EMPTY_CSV");
  }

  const headers = splitCsvLine(lines[0])
    .map(x => x.trim());

  const idx = Object.fromEntries(
    headers.map((h, i) => [h, i])
  );

  const required = [
    "Date",
    "HomeTeam",
    "AwayTeam",
    "FTHG",
    "FTAG",
    "HTHG",
    "HTAG"
  ];

  for (const field of required) {
    if (!(field in idx)) {
      throw new Error(`MISSING_COLUMN_${field}`);
    }
  }

  const fixtures = [];
  let skippedIncomplete = 0;

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);

    const date = normalizeDate(cols[idx.Date]);

    const home =
      String(cols[idx.HomeTeam] ?? "").trim();

    const away =
      String(cols[idx.AwayTeam] ?? "").trim();

    const fthg =
      parseScoreField(cols[idx.FTHG]);

    const ftag =
      parseScoreField(cols[idx.FTAG]);

    const hthg =
      parseScoreField(cols[idx.HTHG]);

    const htag =
      parseScoreField(cols[idx.HTAG]);

    if (
      !date ||
      !home ||
      !away ||
      fthg === null ||
      ftag === null ||
      hthg === null ||
      htag === null
    ) {
      skippedIncomplete++;
      continue;
    }

    const row = {
      source: "football-data",
      source_id: source.id,
      provenance_url: source.url,

      season: source.season,
      competition: source.competition,
      league: source.league,

      date,

      home_team: home,
      away_team: away,

      ht_home: hthg,
      ht_away: htag,
      ft_home: fthg,
      ft_away: ftag,

      ht_score: `${hthg}-${htag}`,
      ft_score: `${fthg}-${ftag}`,

      completed: true
    };

    row.identity_key = identity(row);

    fixtures.push(row);
  }

  const unique = [
    ...new Map(
      fixtures.map(x => [
        x.identity_key,
        x
      ])
    ).values()
  ];

  return {
    fixtures: unique,
    skippedIncomplete,
    duplicatesRemoved:
      fixtures.length - unique.length
  };
}

console.log("CFI HISTORICAL LOCAL REBUILD");
console.log(`PARSER: ${PARSER_VERSION}`);
console.log("");

let successful = 0;
let failed = 0;
let totalSkippedIncomplete = 0;
let totalDuplicatesRemoved = 0;

const allFixtures = [];
const sourceAudit = [];

for (const source of HISTORICAL_SOURCES) {
  const safeName = source.id.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  const rawFile = resolve(
    `local-node/cache/historical/football-data/raw/${safeName}.csv`
  );

  const normalizedFile = resolve(
    `local-node/cache/historical/football-data/normalized/${safeName}.json`
  );

  try {
    const bytes = await readFile(rawFile);

    const sha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");

    const result = parseSource(
      source,
      bytes.toString("utf8")
    );

    await saveJson(normalizedFile, {
      contract: "CFI_LOCAL_HISTORICAL_V2",
      parserVersion: PARSER_VERSION,
      source: source.id,
      rebuiltAt: new Date().toISOString(),
      sha256,
      rows: result.fixtures.length,
      skippedIncomplete:
        result.skippedIncomplete,
      duplicatesRemoved:
        result.duplicatesRemoved,
      fixtures: result.fixtures
    });

    successful++;

    totalSkippedIncomplete +=
      result.skippedIncomplete;

    totalDuplicatesRemoved +=
      result.duplicatesRemoved;

    allFixtures.push(...result.fixtures);

    const audit = {
      source: source.id,
      status: "REPARSED_LOCAL",
      rows: result.fixtures.length,
      skippedIncomplete:
        result.skippedIncomplete
    };

    sourceAudit.push(audit);
    console.log(audit);

  } catch (error) {
    failed++;

    const audit = {
      source: source.id,
      status: "REPARSE_ERROR",
      error: String(
        error?.message ?? error
      )
    };

    sourceAudit.push(audit);
    console.log(audit);
  }
}

const uniqueCorpus = [
  ...new Map(
    allFixtures.map(x => [
      x.identity_key,
      x
    ])
  ).values()
];

let previousManifest = {};

try {
  previousManifest =
    JSON.parse(
      await readFile(MANIFEST_FILE, "utf8")
    );
} catch {}

await saveJson(MANIFEST_FILE, {
  ...previousManifest,

  contract:
    "CFI_LOCAL_HISTORICAL_MANIFEST_V2",

  parserVersion: PARSER_VERSION,
  rebuiltAt: new Date().toISOString(),

  sourcesConfigured:
    HISTORICAL_SOURCES.length,

  sourcesSuccessful: successful,
  sourcesFailed: failed,

  collectedRows: allFixtures.length,
  uniqueRows: uniqueCorpus.length,

  duplicatesRemoved:
    allFixtures.length -
    uniqueCorpus.length,

  skippedIncomplete:
    totalSkippedIncomplete,

  localRebuild: true,
  networkDownloads: 0,

  bigDbWriteAttempted: false,

  rebuildSourceAudit: sourceAudit,

  fixtures: uniqueCorpus
});

console.log("");
console.log("CFI LOCAL REBUILD SUMMARY");

console.log({
  sourcesConfigured:
    HISTORICAL_SOURCES.length,

  sourcesSuccessful: successful,
  sourcesFailed: failed,

  completedRows:
    allFixtures.length,

  uniqueRows:
    uniqueCorpus.length,

  skippedIncomplete:
    totalSkippedIncomplete,

  duplicatesRemoved:
    allFixtures.length -
    uniqueCorpus.length,

  parserVersion:
    PARSER_VERSION,

  networkDownloads: 0,

  bigDbWriteAttempted: false
});
