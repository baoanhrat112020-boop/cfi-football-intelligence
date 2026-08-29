import {
  readFile,
  writeFile,
  mkdir
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

const PROBE_FILE = resolve(
  "local-node/cache/browser/source-probe-audit.json"
);

const OUTPUT = resolve(
  "local-node/cache/browser/snapshot-structure-audit.json"
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

function clean(line) {
  return String(line ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function classifyLine(line) {
  const flags = [];

  if (
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\b/i.test(line)
  ) {
    flags.push("WEEKDAY");
  }

  if (
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(line)
  ) {
    flags.push("MONTH");
  }

  if (
    /\b20\d{2}\b/.test(line)
  ) {
    flags.push("YEAR");
  }

  if (
    /\b\d{1,2}:\d{2}\b/.test(line)
  ) {
    flags.push("TIME");
  }

  if (
    /\b(?:Today|Tomorrow|Yesterday)\b/i.test(line)
  ) {
    flags.push("RELATIVE_DATE");
  }

  if (
    /\b(?:vs\.?|v)\b/i.test(line)
  ) {
    flags.push("VERSUS");
  }

  if (
    /\b(?:FT|HT|Postponed|Cancelled|Scheduled)\b/i.test(line)
  ) {
    flags.push("STATUS");
  }

  return flags;
}

const probe =
  JSON.parse(
    await readFile(PROBE_FILE, "utf8")
  );

console.log(
  "CFI BROWSER SNAPSHOT STRUCTURE AUDIT"
);

console.log(
  "MODE: READ_ONLY"
);

console.log("");

const results = [];

for (const source of probe.results ?? []) {
  if (!source.snapshot) continue;

  const text =
    await readFile(
      source.snapshot,
      "utf8"
    );

  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const interesting = [];

  const flagCounts = {};

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const flags =
      classifyLine(lines[i]);

    for (const flag of flags) {
      flagCounts[flag] =
        (flagCounts[flag] ?? 0) + 1;
    }

    if (
      flags.includes("TIME") ||
      flags.includes("VERSUS") ||
      flags.includes("RELATIVE_DATE") ||
      (
        flags.includes("MONTH") &&
        (
          flags.includes("YEAR") ||
          flags.includes("WEEKDAY")
        )
      )
    ) {
      interesting.push({
        lineNumber: i + 1,
        text: lines[i],
        flags,

        before:
          i > 0
            ? lines[i - 1]
            : null,

        after:
          i + 1 < lines.length
            ? lines[i + 1]
            : null
      });
    }
  }

  const result = {
    source_id:
      source.source_id,

    provider:
      source.provider,

    target_class:
      source.target_class,

    snapshot:
      source.snapshot,

    lines:
      lines.length,

    flagCounts,

    interestingLines:
      interesting.length,

    samples:
      interesting.slice(0, 40)
  };

  results.push(result);

  console.log({
    source:
      result.source_id,

    lines:
      result.lines,

    interestingLines:
      result.interestingLines,

    flags:
      result.flagCounts
  });
}

const audit = {
  contract:
    "CFI_BROWSER_SNAPSHOT_STRUCTURE_AUDIT_V1",

  generatedAt:
    new Date().toISOString(),

  status:
    results.length > 0
      ? "PASS"
      : "FAIL",

  sourcesScanned:
    results.length,

  fixtureParsingAttempted:
    false,

  candidateGenerationAttempted:
    false,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false,

  results
};

await saveJson(
  OUTPUT,
  audit
);

console.log("");

console.log(
  "CFI BROWSER SNAPSHOT STRUCTURE SUMMARY"
);

console.log({
  status:
    audit.status,

  sourcesScanned:
    audit.sourcesScanned,

  fixtureParsingAttempted:
    false,

  candidateGenerationAttempted:
    false,

  bigDbWriteAllowed:
    false,

  bigDbWriteAttempted:
    false
});

console.log("");

console.log(
  `Audit written to: ${OUTPUT}`
);
