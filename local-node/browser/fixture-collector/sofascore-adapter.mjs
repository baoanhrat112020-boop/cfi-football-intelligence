import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SOFASCORE_CROSSCHECK_SOURCES
} from "./sofascore-source-registry.mjs";

const PROBE = resolve(
  "local-node/cache/browser/sofascore-probe-audit.json"
);

const OUTPUT = resolve(
  "local-node/browser/fixture-collector/input/sofascore-candidates.json"
);

const AUDIT = resolve(
  "local-node/cache/browser/sofascore-adapter-audit.json"
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function clean(v) {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseDate(v) {
  const m = clean(v).match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/
  );

  if (!m) return null;

  let year = Number(m[3]);

  if (year < 100) {
    year += 2000;
  }

  return {
    day: Number(m[1]),
    month: Number(m[2]),
    year
  };
}

function isTime(v) {
  return /^\d{1,2}:\d{2}$/.test(clean(v));
}

function isCompletedStatus(v) {
  return /^(FT|AET|PEN|Finished|Full-time)$/i.test(clean(v));
}

function isSkipToken(v) {
  const x = clean(v);

  return (
    !x ||
    x === "-" ||
    /^Round\s+\d+/i.test(x) ||
    /^(Advertisement|Featured)$/i.test(x)
  );
}

function makeKickoff(date, time) {
  const [hour, minute] =
    time.split(":").map(Number);

  const d = new Date(Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute
  ));

  if (
    d.getUTCFullYear() !== date.year ||
    d.getUTCMonth() + 1 !== date.month ||
    d.getUTCDate() !== date.day
  ) {
    return null;
  }

  return d.toISOString();
}

function parseSnapshot(source, text) {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const candidates = [];
  const rejected = [];

  let dateAnchors = 0;
  let completedSkipped = 0;
  let noTimeSkipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const date = parseDate(lines[i]);

    if (!date) continue;

    dateAnchors++;

    let j = i + 1;

    while (
      j < lines.length &&
      isSkipToken(lines[j])
    ) {
      j++;
    }

    if (j >= lines.length) {
      rejected.push({
        date: lines[i],
        reason: "END_AFTER_DATE"
      });
      continue;
    }

    if (isCompletedStatus(lines[j])) {
      completedSkipped++;
      continue;
    }

    if (!isTime(lines[j])) {
      noTimeSkipped++;
      continue;
    }

    const time = lines[j];
    j++;

    while (
      j < lines.length &&
      isSkipToken(lines[j])
    ) {
      j++;
    }

    const home = clean(lines[j]);
    const away = clean(lines[j + 1]);

    if (!home || !away) {
      rejected.push({
        date: lines[i],
        time,
        reason: "MISSING_TEAM"
      });
      continue;
    }

    if (
      parseDate(home) ||
      parseDate(away) ||
      isTime(home) ||
      isTime(away)
    ) {
      rejected.push({
        date: lines[i],
        time,
        home,
        away,
        reason: "INVALID_TEAM_POSITION"
      });
      continue;
    }

    const kickoff =
      makeKickoff(date, time);

    if (!kickoff) {
      rejected.push({
        date: lines[i],
        time,
        reason: "INVALID_CALENDAR_DATE"
      });
      continue;
    }

    candidates.push({
      source_id: source.id,
      source_url: source.url,
      provider_id: null,

      competition: source.competition,
      country: source.country,

      home_team: home,
      away_team: away,

      kickoff_utc: kickoff,

      parser_evidence: {
        provider: "sofascore",
        parser: "SOFASCORE_EXPLICIT_DATE_V1",
        date_line: lines[i],
        time_line: time,
        home_line: home,
        away_line: away,
        browser_timezone: "UTC"
      }
    });
  }

  return {
    dateAnchors,
    completedSkipped,
    noTimeSkipped,
    candidates,
    rejected
  };
}

const probe = JSON.parse(
  await readFile(PROBE, "utf8")
);

const candidates = [];
const rejected = [];
const sources = [];

for (const source of SOFASCORE_CROSSCHECK_SOURCES) {
  const p = (probe.results ?? []).find(
    x => x.source_id === source.id
  );

  if (!p?.snapshot) {
    sources.push({
      source_id: source.id,
      status: "NO_SNAPSHOT"
    });
    continue;
  }

  const text = await readFile(
    p.snapshot,
    "utf8"
  );

  const parsed =
    parseSnapshot(source, text);

  candidates.push(
    ...parsed.candidates
  );

  rejected.push(
    ...parsed.rejected.map(x => ({
      source_id: source.id,
      ...x
    }))
  );

  sources.push({
    source_id: source.id,
    status: "PARSED",
    dateAnchors: parsed.dateAnchors,
    completedSkipped: parsed.completedSkipped,
    noTimeSkipped: parsed.noTimeSkipped,
    candidates: parsed.candidates.length,
    rejected: parsed.rejected.length
  });
}

await saveJson(OUTPUT, {
  contract: "CFI_SOFASCORE_RAW_CANDIDATES_V1",
  generatedAt: new Date().toISOString(),
  timeBasis: "BROWSER_CONTEXT_UTC",
  candidates
});

const audit = {
  contract: "CFI_SOFASCORE_ADAPTER_AUDIT_V1",
  generatedAt: new Date().toISOString(),

  status:
    candidates.length > 0
      ? (
          rejected.length > 0
            ? "PASS_WITH_REJECTIONS"
            : "PASS"
        )
      : "FAIL",

  sourcesConfigured:
    SOFASCORE_CROSSCHECK_SOURCES.length,

  rawCandidates:
    candidates.length,

  rejectedSegments:
    rejected.length,

  sources,

  safeguards: {
    explicitDateOnly: true,
    relativeDateParsing: false,
    fixtureOnly: true,
    generateOdds: false,
    generatePrediction: false,
    generateResult: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  rejected
};

await saveJson(AUDIT, audit);

console.log("CFI SOFASCORE ADAPTER SUMMARY");

console.dir({
  status: audit.status,
  rawCandidates: audit.rawCandidates,
  rejectedSegments: audit.rejectedSegments,
  sources: audit.sources,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
}, { depth: null });
