import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";

const SOURCES = [
  {
    id: "openfootball-world",
    url: "https://github.com/openfootball/world.git"
  },
  {
    id: "openfootball-clubs",
    url: "https://github.com/openfootball/clubs.git"
  }
];

const CACHE_ROOT = resolve("local-node/cache/openfootball");
const STATE_ROOT = resolve("local-node/state/openfootball");

const ALIAS_OUTPUT = resolve(
  "local-node/cache/openfootball/club-alias-manifest.json"
);

function git(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `GIT_FAILED: git ${args.join(" ")}\n${result.stderr ?? ""}`
    );
  }

  return String(result.stdout ?? "").trim();
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function remoteHead(url) {
  const out = git(["ls-remote", url, "HEAD"]);
  return out.split(/\s+/)[0] ?? null;
}

async function syncSource(source) {
  const target = resolve(CACHE_ROOT, source.id);
  const stateFile = resolve(
    STATE_ROOT,
    `${source.id}.json`
  );

  const previous = await loadJson(stateFile);
  const remoteCommit = remoteHead(source.url);

  if (
    previous?.commit === remoteCommit &&
    existsSync(join(target, ".git"))
  ) {
    return {
      source: source.id,
      status: "UNCHANGED",
      commit: remoteCommit,
      path: target
    };
  }

  await mkdir(CACHE_ROOT, { recursive: true });

  if (!existsSync(join(target, ".git"))) {
    git([
      "clone",
      "--depth",
      "1",
      source.url,
      target
    ]);
  } else {
    git([
      "-C",
      target,
      "fetch",
      "--depth",
      "1",
      "origin"
    ]);

    git([
      "-C",
      target,
      "reset",
      "--hard",
      "FETCH_HEAD"
    ]);
  }

  const localCommit = git([
    "-C",
    target,
    "rev-parse",
    "HEAD"
  ]);

  await saveJson(stateFile, {
    source: source.id,
    url: source.url,
    commit: localCommit,
    checkedAt: new Date().toISOString()
  });

  return {
    source: source.id,
    status:
      previous?.commit === localCommit
        ? "UNCHANGED"
        : "UPDATED",
    commit: localCommit,
    path: target
  };
}

async function collectTxtFiles(dir) {
  const output = [];

  for (const entry of await readdir(dir, {
    withFileTypes: true
  })) {
    if (entry.name === ".git") continue;

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      output.push(...await collectTxtFiles(path));
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".txt")
    ) {
      output.push(path);
    }
  }

  return output;
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

function aliasKey(value) {
  return createHash("sha256")
    .update(normalize(value))
    .digest("hex");
}

async function buildAliasManifest(clubsRoot) {
  const files = await collectTxtFiles(clubsRoot);

  const parsed = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);

    let canonical = null;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (!trimmed) continue;

      if (
        trimmed.startsWith("#") ||
        trimmed.startsWith("=")
      ) {
        canonical = null;
        continue;
      }

      if (trimmed.startsWith("|")) {
        if (!canonical) continue;

        const aliases = trimmed
          .split("|")
          .map(x => x.trim())
          .filter(Boolean);

        for (const alias of aliases) {
          const normalized = normalize(alias);
          if (!normalized) continue;

          parsed.push({
            canonical_name: canonical,
            alias,
            alias_normalized: normalized,
            alias_key: aliasKey(alias),
            source: "openfootball-clubs",
            source_file: relative(
              clubsRoot,
              file
            ).replaceAll("\\", "/")
          });
        }

        continue;
      }

      if (/^\s/.test(rawLine)) {
        continue;
      }

      const candidate = trimmed
        .split(",")[0]
        .trim();

      if (
        candidate.length >= 2 &&
        !candidate.startsWith("@") &&
        !candidate.startsWith("-")
      ) {
        canonical = candidate;

        parsed.push({
          canonical_name: candidate,
          alias: candidate,
          alias_normalized: normalize(candidate),
          alias_key: aliasKey(candidate),
          source: "openfootball-clubs",
          source_file: relative(
            clubsRoot,
            file
          ).replaceAll("\\", "/")
        });
      }
    }
  }

  const uniqueMap = new Map();

  for (const row of parsed) {
    const key =
      `${normalize(row.canonical_name)}|${row.alias_normalized}`;

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, row);
    }
  }

  const aliases = [...uniqueMap.values()];

  const byAlias = new Map();

  for (const row of aliases) {
    if (!byAlias.has(row.alias_normalized)) {
      byAlias.set(row.alias_normalized, new Map());
    }

    byAlias
      .get(row.alias_normalized)
      .set(
        normalize(row.canonical_name),
        row.canonical_name
      );
  }

  const collisions = [];

  for (const [alias, canonicals] of byAlias) {
    if (canonicals.size > 1) {
      collisions.push({
        alias_normalized: alias,
        canonical_names: [
          ...canonicals.values()
        ].sort()
      });
    }
  }

  const manifest = {
    contract:
      "CFI_OPENFOOTBALL_ALIAS_MANIFEST_V1",

    generatedAt:
      new Date().toISOString(),

    filesScanned: files.length,
    aliasesParsed: parsed.length,
    aliasesUnique: aliases.length,

    duplicatesRemoved:
      parsed.length - aliases.length,

    ambiguousAliasKeys:
      collisions.length,

    collisionPolicy:
      "AMBIGUOUS_EXACT_ALIAS_FAIL_CLOSED",

    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false,

    collisions,
    aliases
  };

  await saveJson(ALIAS_OUTPUT, manifest);

  return manifest;
}

console.log("CFI OPENFOOTBALL SYNC");
console.log("MODE: LOCAL_ONLY");
console.log("");

const syncResults = [];

for (const source of SOURCES) {
  try {
    const result = await syncSource(source);

    syncResults.push(result);

    console.log({
      source: result.source,
      status: result.status,
      commit: result.commit
    });
  } catch (error) {
    const result = {
      source: source.id,
      status: "ERROR",
      error: String(
        error?.message ?? error
      )
    };

    syncResults.push(result);
    console.log(result);
  }
}

const clubs = syncResults.find(
  x =>
    x.source === "openfootball-clubs" &&
    x.status !== "ERROR"
);

let aliasManifest = null;

if (clubs) {
  aliasManifest =
    await buildAliasManifest(clubs.path);

  console.log("");
  console.log("CFI CLUB ALIAS AUDIT");

  console.log({
    filesScanned:
      aliasManifest.filesScanned,

    aliasesParsed:
      aliasManifest.aliasesParsed,

    aliasesUnique:
      aliasManifest.aliasesUnique,

    duplicatesRemoved:
      aliasManifest.duplicatesRemoved,

    ambiguousAliasKeys:
      aliasManifest.ambiguousAliasKeys,

    collisionPolicy:
      aliasManifest.collisionPolicy,

    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  });
}

console.log("");
console.log("CFI OPENFOOTBALL SUMMARY");

console.log({
  sourcesConfigured:
    SOURCES.length,

  sourcesSuccessful:
    syncResults.filter(
      x => x.status !== "ERROR"
    ).length,

  aliasesUnique:
    aliasManifest?.aliasesUnique ?? 0,

  ambiguousAliasKeys:
    aliasManifest?.ambiguousAliasKeys ?? 0,

  bigDbWriteAllowed: false,
  bigDbWriteAttempted: false
});
