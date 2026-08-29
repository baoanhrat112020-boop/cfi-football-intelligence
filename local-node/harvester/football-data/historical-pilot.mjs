import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const SOURCE = {
  id: "football-data-2526-E0",
  season: "2025/26",
  competition: "E0",
  url: "https://www.football-data.co.uk/mmz4281/2526/E0.csv"
};

const RAW_FILE = resolve(
  "local-node/cache/historical/football-data/2526/E0.csv"
);

const OUTPUT_FILE = resolve(
  "local-node/cache/historical/football-data/2526/E0.normalized.json"
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

function identity(row) {
  return createHash("sha256")
    .update(
      [
        row.season,
        row.competition,
        row.date,
        row.home_team,
        row.away_team
      ]
        .join("|")
        .toLowerCase()
    )
    .digest("hex");
}

async function save(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

console.log("CFI HISTORICAL PILOT");
console.log(`SOURCE: ${SOURCE.url}`);

const response = await fetch(SOURCE.url, {
  headers: {
    "user-agent": "CFI-Local-Data-Node/1.0",
    "accept": "text/csv,text/plain,*/*",
    "cache-control": "no-cache"
  },
  redirect: "follow"
});

if (!response.ok) {
  throw new Error(`SOURCE_HTTP_${response.status}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
const text = bytes.toString("utf8").replace(/^\uFEFF/, "");

if (
  /^\s*</.test(text) ||
  !text.includes("HomeTeam") ||
  !text.includes("AwayTeam")
) {
  throw new Error("INVALID_HISTORICAL_CSV_PAYLOAD");
}

const sha256 = createHash("sha256").update(bytes).digest("hex");

await save(RAW_FILE, bytes);

const lines = text.split(/\r?\n/).filter(Boolean);
const headers = splitCsvLine(lines[0]).map(x => x.trim());
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

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
    throw new Error(`MISSING_HISTORICAL_COLUMN_${field}`);
  }
}

const rows = [];

for (const line of lines.slice(1)) {
  const cols = splitCsvLine(line);

  const home = String(cols[idx.HomeTeam] ?? "").trim();
  const away = String(cols[idx.AwayTeam] ?? "").trim();
  const date = String(cols[idx.Date] ?? "").trim();

  const fthg = Number(cols[idx.FTHG]);
  const ftag = Number(cols[idx.FTAG]);
  const hthg = Number(cols[idx.HTHG]);
  const htag = Number(cols[idx.HTAG]);

  if (
    !home ||
    !away ||
    !date ||
    !Number.isFinite(fthg) ||
    !Number.isFinite(ftag) ||
    !Number.isFinite(hthg) ||
    !Number.isFinite(htag)
  ) {
    continue;
  }

  const row = {
    source: "football-data",
    season: SOURCE.season,
    competition: SOURCE.competition,
    date,
    home_team: home,
    away_team: away,
    ht_home: hthg,
    ht_away: htag,
    ft_home: fthg,
    ft_away: ftag,
    ht_score: `${hthg}-${htag}`,
    ft_score: `${fthg}-${ftag}`,
    completed: true,
    provenance_url: SOURCE.url
  };

  row.identity_key = identity(row);

  rows.push(row);
}

const unique = [
  ...new Map(rows.map(row => [row.identity_key, row])).values()
];

await save(
  OUTPUT_FILE,
  JSON.stringify(
    {
      contract: "CFI_LOCAL_HISTORICAL_V1",
      source: SOURCE.id,
      season: SOURCE.season,
      competition: SOURCE.competition,
      fetchedAt: new Date().toISOString(),
      sha256,
      rawBytes: bytes.length,
      parsedRows: rows.length,
      uniqueRows: unique.length,
      duplicatesRemoved: rows.length - unique.length,
      bigDbWriteAttempted: false,
      fixtures: unique
    },
    null,
    2
  )
);

console.log({
  status: "PASS",
  source: SOURCE.id,
  httpStatus: response.status,
  bytes: bytes.length,
  sha256,
  parsedRows: rows.length,
  uniqueRows: unique.length,
  duplicatesRemoved: rows.length - unique.length,
  bigDbWriteAttempted: false
});
