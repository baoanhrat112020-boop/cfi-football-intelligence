import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { HISTORICAL_SOURCES } from "./historical-registry.mjs";

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

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });

  if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    await writeFile(path, value);
  } else {
    await writeFile(
      path,
      JSON.stringify(value, null, 2),
      "utf8"
    );
  }
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
    const yyyy = Number(yy) >= 80
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

function parseHistoricalCsv(source, text) {
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
    headers.map((header, i) => [header, i])
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

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);

    const date = normalizeDate(cols[idx.Date]);
    const home = String(cols[idx.HomeTeam] ?? "").trim();
    const away = String(cols[idx.AwayTeam] ?? "").trim();

    const fthg = Number(cols[idx.FTHG]);
    const ftag = Number(cols[idx.FTAG]);
    const hthg = Number(cols[idx.HTHG]);
    const htag = Number(cols[idx.HTAG]);

    if (
      !date ||
      !home ||
      !away ||
      !Number.isFinite(fthg) ||
      !Number.isFinite(ftag) ||
      !Number.isFinite(hthg) ||
      !Number.isFinite(htag)
    ) {
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

  return [
    ...new Map(
      fixtures.map(x => [x.identity_key, x])
    ).values()
  ];
}

async function harvest(source) {
  const safeName = source.id.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  const stateFile = resolve(
    `local-node/state/historical/football-data/${safeName}.json`
  );

  const rawFile = resolve(
    `local-node/cache/historical/football-data/raw/${safeName}.csv`
  );

  const normalizedFile = resolve(
    `local-node/cache/historical/football-data/normalized/${safeName}.json`
  );

  const previous = await loadJson(stateFile);

  const headers = {
    "user-agent": "CFI-Local-Data-Node/1.0",
    "accept": "text/csv,text/plain,*/*",
    "cache-control": "no-cache"
  };

  if (previous?.etag) {
    headers["if-none-match"] = previous.etag;
  }

  if (previous?.lastModified) {
    headers["if-modified-since"] =
      previous.lastModified;
  }

  let response;

  try {
    response = await fetch(source.url, {
      headers,
      redirect: "follow"
    });
  } catch (error) {
    return {
      source: source.id,
      status: "NETWORK_ERROR",
      error: String(error?.message ?? error),
      fixtures: []
    };
  }

  if (response.status === 304) {
    const existing = await loadJson(normalizedFile);

    return {
      source: source.id,
      status: "UNCHANGED_304",
      rows: existing?.fixtures?.length ?? 0,
      fixtures: existing?.fixtures ?? []
    };
  }

  if (!response.ok) {
    return {
      source: source.id,
      status: "SOURCE_ERROR",
      httpStatus: response.status,
      fixtures: []
    };
  }

  const bytes = Buffer.from(
    await response.arrayBuffer()
  );

  const text = bytes
    .toString("utf8")
    .replace(/^\uFEFF/, "");

  if (
    /^\s*</.test(text) ||
    !text.includes("HomeTeam") ||
    !text.includes("AwayTeam")
  ) {
    return {
      source: source.id,
      status: "INVALID_PAYLOAD",
      httpStatus: response.status,
      bytes: bytes.length,
      fixtures: []
    };
  }

  const sha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");

  if (
    previous?.sha256 === sha256 &&
    await loadJson(normalizedFile)
  ) {
    const existing = await loadJson(normalizedFile);

    await save(stateFile, {
      ...previous,
      checkedAt: new Date().toISOString(),
      httpStatus: response.status
    });

    return {
      source: source.id,
      status: "UNCHANGED_SHA256",
      rows: existing?.fixtures?.length ?? 0,
      sha256,
      fixtures: existing?.fixtures ?? []
    };
  }

  let fixtures;

  try {
    fixtures = parseHistoricalCsv(source, text);
  } catch (error) {
    return {
      source: source.id,
      status: "PARSE_ERROR",
      error: String(error?.message ?? error),
      fixtures: []
    };
  }

  await save(rawFile, bytes);

  await save(normalizedFile, {
    contract: "CFI_LOCAL_HISTORICAL_V1",
    source: source.id,
    fetchedAt: new Date().toISOString(),
    sha256,
    rows: fixtures.length,
    fixtures
  });

  await save(stateFile, {
    source: source.id,
    url: source.url,
    checkedAt: new Date().toISOString(),
    sha256,
    bytes: bytes.length,
    etag: response.headers.get("etag"),
    lastModified:
      response.headers.get("last-modified"),
    rows: fixtures.length
  });

  return {
    source: source.id,
    status: "CHANGED",
    httpStatus: response.status,
    bytes: bytes.length,
    sha256,
    rows: fixtures.length,
    fixtures
  };
}

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

console.log("CFI HISTORICAL REGISTRY");
console.log(
  `SOURCES: ${HISTORICAL_SOURCES.length}`
);
console.log("");

const sourceResults = [];
const allFixtures = [];

for (
  let i = 0;
  i < HISTORICAL_SOURCES.length;
  i++
) {
  const source = HISTORICAL_SOURCES[i];

  const result = await harvest(source);

  allFixtures.push(...result.fixtures);

  const printable = {
    ...result
  };

  delete printable.fixtures;

  sourceResults.push(printable);

  console.log(printable);

  if (i < HISTORICAL_SOURCES.length - 1) {
    await sleep(300);
  }
}

const uniqueFixtures = [
  ...new Map(
    allFixtures.map(x => [x.identity_key, x])
  ).values()
];

const manifest = {
  contract: "CFI_LOCAL_HISTORICAL_MANIFEST_V1",
  generatedAt: new Date().toISOString(),

  sourcesConfigured:
    HISTORICAL_SOURCES.length,

  sourcesSuccessful:
    sourceResults.filter(
      x =>
        x.status === "CHANGED" ||
        x.status === "UNCHANGED_304" ||
        x.status === "UNCHANGED_SHA256"
    ).length,

  sourceResults,

  collectedRows: allFixtures.length,
  uniqueRows: uniqueFixtures.length,
  duplicatesRemoved:
    allFixtures.length - uniqueFixtures.length,

  bigDbWriteAttempted: false,

  fixtures: uniqueFixtures
};

await save(MANIFEST_FILE, manifest);

console.log("");
console.log("CFI HISTORICAL MANIFEST");
console.log({
  sourcesConfigured:
    manifest.sourcesConfigured,
  sourcesSuccessful:
    manifest.sourcesSuccessful,
  collectedRows:
    manifest.collectedRows,
  uniqueRows:
    manifest.uniqueRows,
  duplicatesRemoved:
    manifest.duplicatesRemoved,
  bigDbWriteAttempted: false
});
