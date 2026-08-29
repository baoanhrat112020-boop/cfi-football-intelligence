import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve
} from "node:path";

const ROOT = resolve(
  "local-node/cache/openfootball/openfootball-world"
);

const COVERAGE_FILE = resolve(
  "local-node/cache/openfootball/world-coverage-audit.json"
);

const ALIAS_FILE = resolve(
  "local-node/cache/openfootball/club-alias-manifest.json"
);

const STATE_FILE = resolve(
  "local-node/state/openfootball/openfootball-world.json"
);

const HTFT_OUTPUT = resolve(
  "local-node/cache/openfootball/world-htft-manifest.json"
);

const FTONLY_OUTPUT = resolve(
  "local-node/cache/openfootball/world-ftonly-manifest.json"
);

const AUDIT_OUTPUT = resolve(
  "local-node/cache/openfootball/world-parse-audit.json"
);

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sha(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

const MONTHS = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};

function yearContext(text, file) {
  const head = text
    .split(/\r?\n/)
    .slice(0, 20)
    .join(" ");

  let m = head.match(
    /\b(20\d{2})\s*[\/-]\s*(\d{2,4})\b/
  );

  if (m) {
    const start = Number(m[1]);

    const end =
      m[2].length === 2
        ? Number(`${String(start).slice(0, 2)}${m[2]}`)
        : Number(m[2]);

    return {
      startYear: start,
      endYear: end,
      singleYear: null
    };
  }

  m = head.match(/\b(20\d{2})\b/);

  if (!m) {
    m = file.match(/\b(20\d{2})\b/);
  }

  return {
    startYear: null,
    endYear: null,
    singleYear: m ? Number(m[1]) : null
  };
}

function inferYear(monthNumber, context, previousYear) {
  if (previousYear) {
    return previousYear;
  }

  if (
    context.startYear &&
    context.endYear
  ) {
    return monthNumber >= 7
      ? context.startYear
      : context.endYear;
  }

  return context.singleYear;
}


function validCalendarDate(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const d = new Date(
    Date.UTC(year, month - 1, day)
  );

  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

function formatIsoDate(year, month, day) {
  if (!validCalendarDate(year, month, day)) {
    return null;
  }

  return (
    String(year) +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function inferCompactSeasonYear(
  monthNumber,
  context
) {
  /*
    OpenFootball sources such as Nigeria use:

      14.10.
      09.01.

    with the year omitted.

    For an explicit season such as 2023/2024:
      Jul-Dec -> 2023
      Jan-Jun -> 2024

    Do NOT use previousYear here, otherwise
    09.01. after 14.10. would incorrectly stay
    in 2023.
  */

  if (
    context.startYear &&
    context.endYear
  ) {
    if (
      context.startYear !==
      context.endYear
    ) {
      return monthNumber >= 7
        ? context.startYear
        : context.endYear;
    }

    return context.startYear;
  }

  if (context.singleYear) {
    return context.singleYear;
  }

  return null;
}

function parseDateHeader(
  line,
  context,
  previousYear
) {
  const trimmed = String(line ?? "")
    .replace(/\u00a0/g, " ")
    .trim();

  /*
    ISO form:
      2025-02-22
  */
  let m = trimmed.match(
    /^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})$/
  );

  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);

    const date =
      formatIsoDate(year, month, day);

    if (!date) return null;

    return {
      date,
      year
    };
  }

  /*
    OpenFootball compact DMY form:
      14.10.
      09.01.

    This is the missing format responsible
    for the current unresolved-date cohort.
  */
  m = trimmed.match(
    /^(\d{1,2})\.(\d{1,2})\.$/
  );

  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);

    const year =
      inferCompactSeasonYear(
        month,
        context
      );

    if (!year) {
      return null;
    }

    const date =
      formatIsoDate(
        year,
        month,
        day
      );

    if (!date) {
      return null;
    }

    return {
      date,
      year
    };
  }

  /*
    Standard Football.TXT form:
      Sat Feb 22 2025
      Sun Feb 23
  */
  m = trimmed.match(
    /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?([A-Za-z]{3})\s+(\d{1,2})(?:\s+((?:19|20)\d{2}))?$/
  );

  if (!m) {
    return null;
  }

  const month =
    MONTHS[
      m[1].toLowerCase()
    ];

  if (!month) {
    return null;
  }

  const monthNumber =
    Number(month);

  const day =
    Number(m[2]);

  const year = m[3]
    ? Number(m[3])
    : inferYear(
        monthNumber,
        context,
        previousYear
      );

  if (!year) {
    return null;
  }

  const date =
    formatIsoDate(
      year,
      monthNumber,
      day
    );

  if (!date) {
    return null;
  }

  return {
    date,
    year
  };
}


function buildAliasResolver(aliasManifest) {
  const map = new Map();

  for (const row of aliasManifest.aliases ?? []) {
    const key =
      row.alias_normalized ||
      normalize(row.alias);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, new Set());
    }

    map.get(key).add(
      row.canonical_name
    );
  }

  return rawName => {
    const key = normalize(rawName);

    const set = map.get(key);

    if (!set || set.size === 0) {
      return {
        raw_name: rawName,
        canonical_name: null,
        identity_name: key,
        resolution: "UNRESOLVED"
      };
    }

    if (set.size > 1) {
      return {
        raw_name: rawName,
        canonical_name: null,
        identity_name: key,
        resolution: "AMBIGUOUS_EXACT_ALIAS"
      };
    }

    const canonical =
      [...set][0];

    return {
      raw_name: rawName,
      canonical_name: canonical,
      identity_name:
        normalize(canonical),
      resolution: "EXACT_ALIAS"
    };
  };
}

function parseMatchLine(line) {
  const separator =
    line.match(/\s+v\s+/i);

  if (!separator) return null;

  let home = line
    .slice(0, separator.index)
    .trim();

  home = home.replace(
    /^\d{1,2}:\d{2}\s+/,
    ""
  );

  const afterV = line
    .slice(
      separator.index +
      separator[0].length
    )
    .trim();

  const htFt = afterV.match(
    /^(.*?)\s+(\d+)-(\d+)\s*\((\d+)-(\d+)\)(?:\s|$)/
  );

  if (htFt) {
    return {
      class: "HT_FT",
      home,
      away: htFt[1].trim(),
      ft_home: Number(htFt[2]),
      ft_away: Number(htFt[3]),
      ht_home: Number(htFt[4]),
      ht_away: Number(htFt[5])
    };
  }

  const ft = afterV.match(
    /^(.*?)\s+(\d+)-(\d+)(?:\s|$)/
  );

  if (ft) {
    return {
      class: "FT_ONLY",
      home,
      away: ft[1].trim(),
      ft_home: Number(ft[2]),
      ft_away: Number(ft[3])
    };
  }

  return {
    class: "FIXTURE_ONLY",
    home,
    away: afterV
  };
}

function recordIdentity({
  competitionKey,
  date,
  homeIdentity,
  awayIdentity
}) {
  return sha(
    [
      competitionKey,
      date,
      homeIdentity,
      awayIdentity
    ]
      .join("|")
      .toLowerCase()
  );
}

const coverage =
  await loadJson(COVERAGE_FILE);

const aliasManifest =
  await loadJson(ALIAS_FILE);

let sourceState = {};

try {
  sourceState =
    await loadJson(STATE_FILE);
} catch {}

const resolveTeam =
  buildAliasResolver(aliasManifest);

console.log(
  "CFI OPENFOOTBALL WORLD PARSE"
);
console.log(
  "MODE: LOCAL_CANONICAL_BRIDGE"
);
console.log("");

const htft = [];
const ftonly = [];

let classifiedHtFt = 0;
let classifiedFtOnly = 0;
let classifiedFixtureOnly = 0;

let unresolvedDates = 0;
let impossibleHtGtFt = 0;

let exactAliasSides = 0;
let unresolvedAliasSides = 0;
let ambiguousAliasSides = 0;

const diagnostics = {
  unresolvedDates: [],
  impossibleHtGtFt: []
};

for (const fileAudit of coverage.files ?? []) {
  const rel = fileAudit.file;

  const fullPath =
    join(ROOT, ...rel.split("/"));

  const text =
    await readFile(fullPath, "utf8");

  const context =
    yearContext(text, rel);

  const pathParts = rel.split("/");

  const region =
    pathParts[0] ?? "unknown";

  const datasetGroup =
    pathParts[1] ?? "unknown";

  const competitionKey =
    `${region}/${datasetGroup}`;

  let currentDate = null;
  let currentYear = null;

  for (
    const rawLine of text.split(/\r?\n/)
  ) {
    const trimmed = rawLine.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("=") ||
      trimmed.startsWith("▪")
    ) {
      continue;
    }

    const parsedDate =
      parseDateHeader(
        trimmed,
        context,
        currentYear
      );

    if (parsedDate) {
      currentDate =
        parsedDate.date;

      currentYear =
        parsedDate.year;

      continue;
    }

    const match =
      parseMatchLine(trimmed);

    if (!match) continue;

    if (
      match.class ===
      "FIXTURE_ONLY"
    ) {
      classifiedFixtureOnly++;
      continue;
    }

    if (
      match.class === "HT_FT"
    ) {
      classifiedHtFt++;
    } else {
      classifiedFtOnly++;
    }

    if (!currentDate) {
      unresolvedDates++;

      if (
        diagnostics
          .unresolvedDates
          .length < 100
      ) {
        diagnostics
          .unresolvedDates
          .push({
            file: rel,
            line: trimmed
          });
      }

      continue;
    }

    const homeResolution =
      resolveTeam(match.home);

    const awayResolution =
      resolveTeam(match.away);

    for (
      const resolution of [
        homeResolution,
        awayResolution
      ]
    ) {
      if (
        resolution.resolution ===
        "EXACT_ALIAS"
      ) {
        exactAliasSides++;
      } else if (
        resolution.resolution ===
        "AMBIGUOUS_EXACT_ALIAS"
      ) {
        ambiguousAliasSides++;
      } else {
        unresolvedAliasSides++;
      }
    }

    const base = {
      source: "openfootball-world",
      source_commit:
        sourceState.commit ?? null,

      source_file: rel,

      region,
      dataset_group:
        datasetGroup,

      competition_key:
        competitionKey,

      date: currentDate,

      home_team_raw:
        match.home,

      away_team_raw:
        match.away,

      home_team_canonical:
        homeResolution
          .canonical_name,

      away_team_canonical:
        awayResolution
          .canonical_name,

      home_resolution:
        homeResolution
          .resolution,

      away_resolution:
        awayResolution
          .resolution
    };

    base.identity_key =
      recordIdentity({
        competitionKey,
        date: currentDate,

        homeIdentity:
          homeResolution
            .identity_name,

        awayIdentity:
          awayResolution
            .identity_name
      });

    if (
      match.class === "HT_FT"
    ) {
      if (
        match.ht_home >
          match.ft_home ||
        match.ht_away >
          match.ft_away
      ) {
        impossibleHtGtFt++;

        if (
          diagnostics
            .impossibleHtGtFt
            .length < 100
        ) {
          diagnostics
            .impossibleHtGtFt
            .push({
              ...base,
              ht:
                `${match.ht_home}-${match.ht_away}`,
              ft:
                `${match.ft_home}-${match.ft_away}`
            });
        }

        continue;
      }

      htft.push({
        ...base,

        evidence_class:
          "HT_FT_GLOBAL_CANDIDATE",

        ht_home:
          match.ht_home,

        ht_away:
          match.ht_away,

        ft_home:
          match.ft_home,

        ft_away:
          match.ft_away,

        ht_score:
          `${match.ht_home}-${match.ht_away}`,

        ft_score:
          `${match.ft_home}-${match.ft_away}`,

        htEvidenceAvailable:
          true,

        ftEvidenceAvailable:
          true,

        decisionUse: false
      });

      continue;
    }

    ftonly.push({
      ...base,

      evidence_class:
        "FT_ONLY_AUXILIARY",

      ft_home:
        match.ft_home,

      ft_away:
        match.ft_away,

      ft_score:
        `${match.ft_home}-${match.ft_away}`,

      ht_home: null,
      ht_away: null,
      ht_score: null,

      htEvidenceAvailable:
        false,

      ftEvidenceAvailable:
        true,

      decisionUse: false
    });
  }
}

function dedup(records) {
  const map = new Map();
  const conflicts = [];

  for (const row of records) {
    const previous =
      map.get(row.identity_key);

    if (!previous) {
      map.set(
        row.identity_key,
        row
      );
      continue;
    }

    const a = JSON.stringify({
      ht: previous.ht_score ?? null,
      ft: previous.ft_score
    });

    const b = JSON.stringify({
      ht: row.ht_score ?? null,
      ft: row.ft_score
    });

    if (a !== b) {
      conflicts.push({
        identity_key:
          row.identity_key,

        first: previous,
        second: row
      });
    }
  }

  return {
    unique: [...map.values()],
    conflicts
  };
}

const htftDedup =
  dedup(htft);

const ftDedup =
  dedup(ftonly);

const expectedHtFt =
  coverage
    .evidenceClasses
    ?.HT_FT
    ?.rows ?? null;

const expectedFtOnly =
  coverage
    .evidenceClasses
    ?.FT_ONLY
    ?.rows ?? null;

const expectedFixtureOnly =
  coverage
    .evidenceClasses
    ?.FIXTURE_ONLY
    ?.rows ?? null;

const blockers = [];

if (
  expectedHtFt !== null &&
  classifiedHtFt !==
    expectedHtFt
) {
  blockers.push(
    "HTFT_CLASS_COUNT_MISMATCH"
  );
}

if (
  expectedFtOnly !== null &&
  classifiedFtOnly !==
    expectedFtOnly
) {
  blockers.push(
    "FTONLY_CLASS_COUNT_MISMATCH"
  );
}

if (
  expectedFixtureOnly !== null &&
  classifiedFixtureOnly !==
    expectedFixtureOnly
) {
  blockers.push(
    "FIXTURE_CLASS_COUNT_MISMATCH"
  );
}

if (unresolvedDates > 0) {
  blockers.push(
    "UNRESOLVED_MATCH_DATES"
  );
}

if (impossibleHtGtFt > 0) {
  blockers.push(
    "IMPOSSIBLE_HT_GT_FT"
  );
}

if (
  htftDedup.conflicts.length > 0 ||
  ftDedup.conflicts.length > 0
) {
  blockers.push(
    "IDENTITY_SCORE_COLLISION"
  );
}

const warnings = [];

if (
  ambiguousAliasSides > 0
) {
  warnings.push(
    "AMBIGUOUS_ALIASES_FAIL_CLOSED"
  );
}

if (
  unresolvedAliasSides > 0
) {
  warnings.push(
    "UNRESOLVED_TEAM_ALIASES"
  );
}

const status =
  blockers.length > 0
    ? "FAIL"
    : warnings.length > 0
      ? "PASS_WITH_WARNINGS"
      : "PASS";

await saveJson(
  HTFT_OUTPUT,
  {
    contract:
      "CFI_OPENFOOTBALL_HTFT_MANIFEST_V1",

    generatedAt:
      new Date().toISOString(),

    source_commit:
      sourceState.commit ?? null,

    evidence_class:
      "HT_FT_GLOBAL_CANDIDATE",

    rows:
      htftDedup.unique.length,

    identityConflicts:
      htftDedup.conflicts.length,

    bigDbWriteAllowed:
      false,

    bigDbWriteAttempted:
      false,

    fixtures:
      htftDedup.unique
  }
);

await saveJson(
  FTONLY_OUTPUT,
  {
    contract:
      "CFI_OPENFOOTBALL_FTONLY_MANIFEST_V1",

    generatedAt:
      new Date().toISOString(),

    source_commit:
      sourceState.commit ?? null,

    evidence_class:
      "FT_ONLY_AUXILIARY",

    rows:
      ftDedup.unique.length,

    identityConflicts:
      ftDedup.conflicts.length,

    inferMissingHtAsZero:
      false,

    bigDbWriteAllowed:
      false,

    bigDbWriteAttempted:
      false,

    fixtures:
      ftDedup.unique
  }
);

const audit = {
  contract:
    "CFI_OPENFOOTBALL_WORLD_PARSE_AUDIT_V1",

  generatedAt:
    new Date().toISOString(),

  status,
  blockers,
  warnings,

  classified: {
    htFtRows:
      classifiedHtFt,

    ftOnlyRows:
      classifiedFtOnly,

    fixtureOnlyRows:
      classifiedFixtureOnly
  },

  expected: {
    htFtRows:
      expectedHtFt,

    ftOnlyRows:
      expectedFtOnly,

    fixtureOnlyRows:
      expectedFixtureOnly
  },

  manifests: {
    htFtUniqueRows:
      htftDedup.unique.length,

    ftOnlyUniqueRows:
      ftDedup.unique.length
  },

  aliasBridge: {
    exactAliasSides,
    ambiguousAliasSides,
    unresolvedAliasSides,

    policy:
      "EXACT_ONLY_FAIL_CLOSED"
  },

  integrity: {
    unresolvedDates,

    impossibleHtGtFt,

    htFtIdentityConflicts:
      htftDedup
        .conflicts
        .length,

    ftOnlyIdentityConflicts:
      ftDedup
        .conflicts
        .length
  },

  fixtureOnlyHistoricalEvidence:
    false,

  inferMissingHtAsZero:
    false,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false,

  diagnostics
};

await saveJson(
  AUDIT_OUTPUT,
  audit
);

console.log(
  "CFI OPENFOOTBALL WORLD PARSE AUDIT"
);

console.log({
  status,
  blockers,
  warnings,

  classifiedHtFt,
  expectedHtFt,

  classifiedFtOnly,
  expectedFtOnly,

  classifiedFixtureOnly,
  expectedFixtureOnly,

  htFtUniqueRows:
    htftDedup.unique.length,

  ftOnlyUniqueRows:
    ftDedup.unique.length,

  exactAliasSides,
  ambiguousAliasSides,
  unresolvedAliasSides,

  unresolvedDates,
  impossibleHtGtFt,

  htFtIdentityConflicts:
    htftDedup
      .conflicts
      .length,

  ftOnlyIdentityConflicts:
    ftDedup
      .conflicts
      .length,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false
});
