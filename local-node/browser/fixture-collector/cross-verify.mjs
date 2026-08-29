import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOCCERWAY_FILE = resolve(
  "local-node/cache/browser/fixture-candidates.json"
);

const SOFASCORE_FILE = resolve(
  "local-node/browser/fixture-collector/input/sofascore-candidates.json"
);

const OUTPUT = resolve(
  "local-node/cache/browser/cross-source-fixture-verification.json"
);

const AUDIT = resolve(
  "local-node/cache/browser/cross-source-verification-audit.json"
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function baseNormalize(value) {
 return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const EXACT_ALIASES = new Map([
  ["amedspor", "amed"],
  ["amed sportif faaliyetler", "amed"],

  ["i basaksehir", "basaksehir"],
  ["basaksehir", "basaksehir"],

  ["caykur rizespor", "rizespor"],
  ["rizespor", "rizespor"],

  ["corum", "corum"],
  ["corum fk", "corum"],

  ["ferro", "ferro carril oeste"],
  ["ferro carril oeste", "ferro carril oeste"],

  ["atl rafaela", "atletico rafaela"],
  ["atletico rafaela", "atletico rafaela"],

  ["ind rivadavia", "independiente rivadavia"],
  ["independiente riv", "independiente rivadavia"],
  ["independiente rivadavia", "independiente rivadavia"],

  ["deportivo riestra", "riestra"],
  ["cd riestra", "riestra"],

  ["gimnasia mendoza", "gimnasia de mendoza"],
  ["gimnasia de mendoza", "gimnasia de mendoza"],

  ["colon santa fe", "colon"],
  ["colon", "colon"],

  ["estudiantes l p", "estudiantes"],
  ["estudiantes", "estudiantes"]
]);

function canonicalTeam(name) {
  let value = baseNormalize(name);

  value = value
    .replace(/\bu19\b/g, "")
    .replace(/\breserves?\b/g, "")
    .replace(/\s+2$/g, "")
    .replace(/\bfc\b/g, "")
    .replace(/\bfk\b/g, "")
    .trim()
    .replace(/\s+/g, " ");

  return EXACT_ALIASES.get(value) ?? value;
}

function cohortFromSource(sourceId) {
  if (
    sourceId === "soccerway-turkey-u19" ||
    sourceId === "sofascore-turkey-u19"
  ) {
    return "TURKEY_U19";
  }

  if (
    sourceId === "soccerway-argentina-reserve" ||
    sourceId === "sofascore-argentina-reserve"
  ) {
    return "ARGENTINA_RESERVE";
  }

  return null;
}

function minutesBetween(a, b) {
  return Math.abs(
    new Date(a).getTime() -
    new Date(b).getTime()
  ) / 60000;
}

function pairKey(fixture) {
  return [
    canonicalTeam(fixture.home_team),
    canonicalTeam(fixture.away_team)
  ].join("|");
}

function reversePairKey(fixture) {
  return [
    canonicalTeam(fixture.away_team),
    canonicalTeam(fixture.home_team)
  ].join("|");
}

const soccerwayManifest = JSON.parse(
  await readFile(SOCCERWAY_FILE, "utf8")
);

const sofascoreManifest = JSON.parse(
  await readFile(SOFASCORE_FILE, "utf8")
);

const soccerway = (soccerwayManifest.fixtures ?? [])
  .filter(x => cohortFromSource(x.source_id));

const sofascore = (sofascoreManifest.candidates ?? [])
  .filter(x => cohortFromSource(x.source_id))
  .filter(x => new Date(x.kickoff_utc).getTime() > Date.now());

const soccerwayByCohort = new Map();

for (const fixture of soccerway) {
  const cohort = cohortFromSource(fixture.source_id);

  if (!soccerwayByCohort.has(cohort)) {
    soccerwayByCohort.set(cohort, []);
  }

  soccerwayByCohort.get(cohort).push(fixture);
}

const matches = [];
const unmatchedSofascore = [];
const conflicts = [];

const matchedSoccerwayKeys = new Set();

for (const sf of sofascore) {
  const cohort = cohortFromSource(sf.source_id);
  const pool = soccerwayByCohort.get(cohort) ?? [];

  const direct = pool.filter(
    sw => pairKey(sw) === pairKey(sf)
  );

  const reversed = pool.filter(
    sw => pairKey(sw) === reversePairKey(sf)
  );

  if (direct.length === 0 && reversed.length > 0) {
    const nearest = reversed
      .map(sw => ({
        sw,
        diff: minutesBetween(sw.kickoff_utc, sf.kickoff_utc)
      }))
      .sort((a, b) => a.diff - b.diff)[0];

    conflicts.push({
      type: "HOME_AWAY_CONFLICT",
      cohort,

      sofascore: sf,

      soccerway: nearest?.sw ?? null,

      kickoffDifferenceMinutes:
        nearest?.diff ?? null,

      decisionUse: false
    });

    continue;
  }

  if (direct.length === 0) {
    unmatchedSofascore.push({
      status: "SINGLE_SOURCE_SOFASCORE",
      cohort,
      fixture: sf,
      decisionUse: false
    });

    continue;
  }

  const ranked = direct
    .map(sw => ({
      sw,
      diff:
        minutesBetween(
          sw.kickoff_utc,
          sf.kickoff_utc
        )
    }))
    .sort((a, b) => a.diff - b.diff);

  if (
    ranked.length > 1 &&
    ranked[0].diff === ranked[1].diff
  ) {
    conflicts.push({
      type: "AMBIGUOUS_MULTIPLE_FIXTURE_MATCH",
      cohort,
      sofascore: sf,
      candidates: ranked.slice(0, 5),
      decisionUse: false
    });

    continue;
  }

  const best = ranked[0];
  const diff = best.diff;

  let status;

  if (diff <= 30) {
    status = "CROSS_VERIFIED_STRONG";
  } else if (diff <= 120) {
    status = "CROSS_VERIFIED_TIME_DISAGREEMENT";
  } else {
    status = "KICKOFF_CONFLICT_FAIL_CLOSED";
  }

  const record = {
    status,
    cohort,

    canonicalHome:
      canonicalTeam(sf.home_team),

    canonicalAway:
      canonicalTeam(sf.away_team),

    kickoffDifferenceMinutes:
      diff,

    soccerway: {
      source_id:
        best.sw.source_id,

      home_team:
        best.sw.home_team,

      away_team:
        best.sw.away_team,

      kickoff_utc:
        best.sw.kickoff_utc,

      source_url:
        best.sw.source_url
    },

    sofascore: {
      source_id:
        sf.source_id,

      home_team:
        sf.home_team,

      away_team:
        sf.away_team,

      kickoff_utc:
        sf.kickoff_utc,

      source_url:
        sf.source_url
    },

    decisionUse: false
  };

  if (
    status ===
    "KICKOFF_CONFLICT_FAIL_CLOSED"
  ) {
    conflicts.push(record);
  } else {
    matches.push(record);

    matchedSoccerwayKeys.add(
      [
        best.sw.source_id,
        best.sw.identity_key
      ].join("|")
    );
  }
}

const unmatchedSoccerway = soccerway
  .filter(sw => {
    const key = [
      sw.source_id,
      sw.identity_key
    ].join("|");

    return !matchedSoccerwayKeys.has(key);
  })
  .map(sw => ({
    status: "SINGLE_SOURCE_SOCCERWAY",
    cohort: cohortFromSource(sw.source_id),
    fixture: sw,
    decisionUse: false
  }));

const strong = matches.filter(
  x => x.status === "CROSS_VERIFIED_STRONG"
);

const timeDisagreement = matches.filter(
  x =>
    x.status ===
    "CROSS_VERIFIED_TIME_DISAGREEMENT"
);

const result = {
  contract:
    "CFI_CROSS_SOURCE_FIXTURE_VERIFICATION_V1",

  generatedAt:
    new Date().toISOString(),

  matchingPolicy: {
    fuzzyMatching: false,
    deterministicAliasesOnly: true,
    requireHomeAwayDirection: true,
    strongKickoffToleranceMinutes: 30,
    disagreementToleranceMinutes: 120,
    averageKickoffTimes: false,
    decisionUse: false
  },

  crossVerifiedStrong: strong,
  crossVerifiedTimeDisagreement: timeDisagreement,
  conflicts,
  unmatchedSofascore,
  unmatchedSoccerway,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

await saveJson(OUTPUT, result);

const audit = {
  contract:
    "CFI_CROSS_SOURCE_FIXTURE_VERIFICATION_AUDIT_V1",

  generatedAt:
    new Date().toISOString(),

  status:
    conflicts.length === 0
      ? "PASS"
      : "PASS_WITH_CONFLICTS_FAIL_CLOSED",

  sofascoreProspectiveInput:
    sofascore.length,

  soccerwayProspectiveCohortInput:
    soccerway.length,

  crossVerifiedStrong:
    strong.length,

  crossVerifiedTimeDisagreement:
    timeDisagreement.length,

  totalCrossVerified:
    matches.length,

  conflicts:
    conflicts.length,

  unmatchedSofascore:
    unmatchedSofascore.length,

  unmatchedSoccerway:
    unmatchedSoccerway.length,

  byStatus: {
    CROSS_VERIFIED_STRONG:
      strong.length,

    CROSS_VERIFIED_TIME_DISAGREEMENT:
      timeDisagreement.length,

    CONFLICT_FAIL_CLOSED:
      conflicts.length,

    SINGLE_SOURCE_SOFASCORE:
      unmatchedSofascore.length,

    SINGLE_SOURCE_SOCCERWAY:
      unmatchedSoccerway.length
  },

  safeguards: {
    fuzzyMatching: false,
    automaticKickoffCorrection: false,
    homeAwaySwapAllowed: false,
    conflictsDecisionUse: false
  },

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
};

await saveJson(AUDIT, audit);

console.log(
  "CFI CROSS-SOURCE VERIFICATION SUMMARY"
);

console.dir(audit, {
  depth: null
});
