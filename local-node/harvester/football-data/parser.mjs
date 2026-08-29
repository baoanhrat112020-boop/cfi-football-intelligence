import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const INPUT = resolve("local-node/cache/football-data-fixtures.csv");
const OUTPUT = resolve("local-node/cache/football-data-fixture-candidates.json");
const PROSPECTIVE = resolve("local-node/cache/football-data-prospective.json");

const SOURCE_URL = "https://www.football-data.co.uk/fixtures.csv";

const COMPETITION_TIMEZONES = {
  EC: "Europe/London",
  SP1: "Europe/Madrid"
};

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

function parseLocalDateTime(date, time) {
  const match = String(date ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const hhmm = /^\d{2}:\d{2}$/.test(String(time ?? "")) ? time : "00:00";

  return `${yyyy}-${mm}-${dd}T${hhmm}:00`;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(x => x.type !== "literal")
      .map(x => [x.type, x.value])
  );

  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return representedAsUtc - date.getTime();
}

function zonedLocalToUtc(localIso, timeZone) {
  const m = localIso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;

  const wallClockUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );

  let guess = wallClockUtc;

  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    guess = wallClockUtc - offset;
  }

  return new Date(guess).toISOString();
}

function identityKey(candidate) {
  const raw = [
    candidate.competition,
    candidate.home_team,
    candidate.away_team,
    candidate.kickoff_utc ?? candidate.kickoff_local_raw
  ]
    .join("|")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}|:+-]/gu, "");

  return createHash("sha256").update(raw).digest("hex");
}

export async function parseFootballDataFixtures() {
  const csv = await readFile(INPUT, "utf8");

  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("FOOTBALL_DATA_FIXTURE_CSV_EMPTY");
  }

  const headers = splitCsvLine(lines[0]);
  const index = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));

  const required = ["Date", "HomeTeam", "AwayTeam"];

  for (const field of required) {
    if (!(field in index)) {
      throw new Error(`FOOTBALL_DATA_MISSING_COLUMN_${field}`);
    }
  }

  const candidates = [];

  for (const line of lines.slice(1)) {
    const row = splitCsvLine(line);

    const home = String(row[index.HomeTeam] ?? "").trim();
    const away = String(row[index.AwayTeam] ?? "").trim();

    const competition =
      "Div" in index
        ? String(row[index.Div] ?? "").trim()
        : "UNKNOWN";

    const date = String(row[index.Date] ?? "").trim();

    const time =
      "Time" in index
        ? String(row[index.Time] ?? "").trim()
        : "";

    if (!home || !away || !date) continue;

    const kickoffLocalRaw = parseLocalDateTime(date, time);
    if (!kickoffLocalRaw) continue;

    const timezone = COMPETITION_TIMEZONES[competition] ?? null;

    const kickoffUtc = timezone
      ? zonedLocalToUtc(kickoffLocalRaw, timezone)
      : null;

    const candidate = {
      home_team: home,
      away_team: away,
      competition,
      kickoff_local_raw: kickoffLocalRaw,
      timezone,
      kickoff_utc: kickoffUtc,
      provider_id: null,
      source: "football-data",
      source_url: SOURCE_URL,
      provenance_status: "SOURCE_PARSED",
      timezone_status: timezone ? "NORMALIZED" : "UNRESOLVED"
    };

    candidate.identity_key = identityKey(candidate);

    candidates.push(candidate);
  }

  const unique = [
    ...new Map(candidates.map(x => [x.identity_key, x])).values()
  ];

  const now = Date.now();

  const prospective = unique.filter(
    x =>
      x.kickoff_utc &&
      new Date(x.kickoff_utc).getTime() > now
  );

  await mkdir(dirname(OUTPUT), { recursive: true });

  await writeFile(
    OUTPUT,
    JSON.stringify(
      {
        source: "football-data",
        generatedAt: new Date().toISOString(),
        parsed: candidates.length,
        unique: unique.length,
        candidates: unique
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    PROSPECTIVE,
    JSON.stringify(
      {
        source: "football-data",
        generatedAt: new Date().toISOString(),
        count: prospective.length,
        candidates: prospective
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    status: "PARSED",
    source: "football-data",
    parsed: candidates.length,
    unique: unique.length,
    prospective: prospective.length,
    timezoneNormalized: unique.filter(x => x.timezone_status === "NORMALIZED").length,
    timezoneUnresolved: unique.filter(x => x.timezone_status === "UNRESOLVED").length,
    bigDbWriteAttempted: false
  };
}
