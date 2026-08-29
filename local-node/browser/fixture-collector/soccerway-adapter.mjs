import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BROWSER_FIXTURE_SOURCES } from "./source-registry.mjs";

const PROBE = resolve("local-node/cache/browser/source-probe-audit.json");
const OUT = resolve("local-node/browser/fixture-collector/input/soccerway-candidates.json");
const AUDIT = resolve("local-node/cache/browser/soccerway-adapter-audit.json");

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function clean(v) {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveYear(day, month, ref) {
  const y = ref.getUTCFullYear();

  const choices = [y - 1, y, y + 1]
    .map(year => {
      const t = Date.UTC(year, month - 1, day, 12);
      const d = new Date(t);

      if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() + 1 !== month ||
        d.getUTCDate() !== day
      ) return null;

      return {
        year,
        distance: Math.abs(t - ref.getTime())
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);

  return choices[0]?.year ?? null;
}

function parseKickoff(line, ref) {
  const m = clean(line).match(
    /^(\d{1,2})\.(\d{1,2})\.\s+(\d{1,2}):(\d{2})$/
  );

  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const hour = Number(m[3]);
  const minute = Number(m[4]);

  const year = resolveYear(day, month, ref);
  if (!year) return null;

  const d = new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute
  ));

  return Number.isNaN(d.getTime())
    ? null
    : d.toISOString();
}

function isTimestamp(line) {
  return /^\d{1,2}\.\d{1,2}\.\s+\d{1,2}:\d{2}$/.test(clean(line));
}

function isNoise(line) {
  const v = clean(line);

  if (!v) return true;

  if (
    v === "-" ||
    v === "FRO" ||
    /^\d+$/.test(v) ||
    /^\d+\s*[-:]\s*\d+$/.test(v)
  ) return true;

  if (/^ROUND\s+\d+/i.test(v)) return true;

  if (
    /^(FT|HT|AET|PEN|POSTPONED|CANCELLED|SCHEDULED)$/i.test(v)
  ) return true;

  if (
    /^(Standings|Archive|Today's Matches|Tomorrow's Matches|Yesterday's Matches)$/i.test(v)
  ) return true;

  if (/^(WORLD|ARGENTINA|TURKEY):?$/i.test(v)) return true;

  return false;
}

function parseSnapshot(source, text, ref) {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const anchors = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isTimestamp(lines[i])) continue;

    const kickoff = parseKickoff(lines[i], ref);

    if (kickoff) {
      anchors.push({
        index: i,
        raw: lines[i],
        kickoff
      });
    }
  }

  const candidates = [];
  const rejected = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const end = anchors[i + 1]?.index ?? lines.length;

    const segment = lines.slice(anchor.index + 1, end);
    const teams = segment.filter(x => !isNoise(x));

    if (teams.length < 2) {
      rejected.push({
        source_id: source.id,
        anchor: anchor.raw,
        reason: "LESS_THAN_TWO_TEAM_LINES",
        segment: segment.slice(0, 12)
      });
      continue;
    }

    const home = teams[0];
    const away = teams[1];

    if (home === away) {
      rejected.push({
        source_id: source.id,
        anchor: anchor.raw,
        reason: "HOME_EQUALS_AWAY",
        segment: segment.slice(0, 12)
      });
      continue;
    }

    candidates.push({
      source_id: source.id,
      source_url: source.url,
      provider_id: null,

      competition:
        source.competition ??
        source.id,

      country:
        source.country ??
        null,

      home_team: home,
      away_team: away,

      kickoff_utc: anchor.kickoff,

      parser_evidence: {
        provider: "soccerway",
        parser: "SOCCERWAY_TEXT_SEGMENT_V1",
        timestamp: anchor.raw,
        home_line: home,
        away_line: away,
        raw_segment: segment.slice(0, 12)
      }
    });
  }

  return {
    anchors: anchors.length,
    candidates,
    rejected
  };
}

const probe = JSON.parse(
  await readFile(PROBE, "utf8")
);

const reference = new Date(
  probe.generatedAt ?? Date.now()
);

const candidates = [];
const rejected = [];
const sources = [];

for (const source of BROWSER_FIXTURE_SOURCES) {
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

  const text = await readFile(p.snapshot, "utf8");

  const parsed = parseSnapshot(
    source,
    text,
    reference
  );

  candidates.push(...parsed.candidates);
  rejected.push(...parsed.rejected);

  sources.push({
    source_id: source.id,
    status: "PARSED",
    anchors: parsed.anchors,
    candidates: parsed.candidates.length,
    rejected: parsed.rejected.length
  });
}

await saveJson(OUT, {
  contract: "CFI_BROWSER_RAW_CANDIDATES_V1",
  generatedAt: new Date().toISOString(),
  snapshotReference: reference.toISOString(),
  timeBasis: "BROWSER_CONTEXT_UTC",
  candidates
});

const audit = {
  contract: "CFI_SOCCERWAY_ADAPTER_AUDIT_V1",
  generatedAt: new Date().toISOString(),

  status:
    candidates.length === 0
      ? "FAIL"
      : rejected.length
        ? "PASS_WITH_REJECTIONS"
        : "PASS",

  sourcesConfigured: BROWSER_FIXTURE_SOURCES.length,
  rawCandidates: candidates.length,
  rejectedSegments: rejected.length,

  sources,

  safeguards: {
    fixtureOnly: true,
    generateOdds: false,
    generatePrediction: false,
    generateResult: false,
    fuzzyCanonicalization: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false,

  rejected
};

await saveJson(AUDIT, audit);

console.log("CFI SOCCERWAY ADAPTER SUMMARY");
console.dir({
  status: audit.status,
  sourcesConfigured: audit.sourcesConfigured,
  rawCandidates: audit.rawCandidates,
  rejectedSegments: audit.rejectedSegments,
  sources: audit.sources,
  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
}, { depth: null });
