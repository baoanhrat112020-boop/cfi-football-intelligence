export const COUNTER_KEYS = [
  "rows", "NEW", "DUPLICATE_COMPATIBLE", "COMPLEMENTARY",
  "CONFLICT", "REJECTED", "ERROR",
];

export function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

export function addCounters(target, source) {
  for (const key of COUNTER_KEYS) target[key] += Number(source?.[key] ?? 0);
  return target;
}

export function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const month = Number(match[2]);
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseScore(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const score = Number(text);
  return Number.isSafeInteger(score) && score >= 0 ? score : null;
}

export function parseFootballDataCsv(csv, source) {
  const lines = String(csv).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV_EMPTY");
  const headers = parseCsvLine(lines[0]).map((value) => value.trim());
  const required = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HTHG", "HTAG"];
  for (const column of required) if (!headers.includes(column)) throw new Error(`MISSING_COLUMN:${column}`);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const fixtures = [];
  let rejected = 0;
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const matchDate = parseDate(columns[index.Date]);
    const homeTeam = String(columns[index.HomeTeam] ?? "").trim();
    const awayTeam = String(columns[index.AwayTeam] ?? "").trim();
    const ftHome = parseScore(columns[index.FTHG]);
    const ftAway = parseScore(columns[index.FTAG]);
    const htHome = parseScore(columns[index.HTHG]);
    const htAway = parseScore(columns[index.HTAG]);
    if (!matchDate || !homeTeam || !awayTeam || homeTeam.toLowerCase() === awayTeam.toLowerCase() ||
        ftHome === null || ftAway === null || htHome === null || htAway === null ||
        htHome > ftHome || htAway > ftAway) {
      rejected++;
      continue;
    }
    fixtures.push({
      matchDate, homeTeam, awayTeam,
      ht: { home: htHome, away: htAway },
      ft: { home: ftHome, away: ftAway },
      sourceType: "CSV",
      sourceLabel: source.url,
      imageHash: null,
    });
  }
  return { rows: lines.length - 1, fixtures, rejected };
}

export function validateManifest(manifest) {
  if (!manifest || !Number.isInteger(manifest.version) || !Array.isArray(manifest.sources)) throw new Error("INVALID_MANIFEST");
  const ids = new Set();
  for (const source of manifest.sources) {
    for (const key of ["id", "provider", "country", "league", "season", "url", "format"]) {
      if (!String(source?.[key] ?? "").trim()) throw new Error(`INVALID_SOURCE:${source?.id ?? "unknown"}:${key}`);
    }
    if (ids.has(source.id)) throw new Error(`DUPLICATE_SOURCE_ID:${source.id}`);
    ids.add(source.id);
    if (source.enabled !== true && source.enabled !== false) throw new Error(`INVALID_SOURCE:${source.id}:enabled`);
    if (!source.url.startsWith("https://")) throw new Error(`INVALID_SOURCE:${source.id}:url`);
    if (source.format !== "football-data-v1") throw new Error(`UNSUPPORTED_FORMAT:${source.id}`);
  }
  return manifest;
}

export function selectSources(manifest, filters = {}) {
  const wanted = (name, value) => !filters[name]?.length || filters[name].includes(value);
  return validateManifest(manifest).sources.filter((source) => source.enabled &&
    wanted("sourceIds", source.id) && wanted("countries", source.country) &&
    wanted("leagues", source.league) && wanted("seasons", source.season) &&
    (!filters.currentOnly || source.current === true));
}

export async function mapBounded(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  return output;
}

export async function importSource(source, dependencies) {
  const started = Date.now();
  const counters = emptyCounters();
  try {
    const csv = await dependencies.fetchText(source.url);
    const parsed = parseFootballDataCsv(csv, source);
    counters.rows = parsed.rows;
    counters.REJECTED = parsed.rejected;
    for (let start = 0; start < parsed.fixtures.length; start += dependencies.batchSize) {
      const result = await dependencies.upsertBatch(parsed.fixtures.slice(start, start + dependencies.batchSize));
      addCounters(counters, { ...result.counters, rows: 0 });
    }
    return { source, status: "COMPLETED", fetchedRows: parsed.rows, acceptedRows: parsed.fixtures.length, counters, elapsedMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SOURCE_NOT_AVAILABLE:")) {
      return { source, status: "NOT_AVAILABLE", fetchedRows: 0, acceptedRows: 0, counters, reason: message, elapsedMs: Date.now() - started };
    }
    counters.ERROR++;
    return { source, status: "FAILED", fetchedRows: 0, acceptedRows: 0, counters, error: message, elapsedMs: Date.now() - started };
  }
}

export async function runBulkImport(manifest, filters, dependencies) {
  const sources = selectSources(manifest, filters);
  const results = await mapBounded(sources, dependencies.concurrency ?? 3, (source) => importSource(source, dependencies));
  const counters = emptyCounters();
  for (const result of results) addCounters(counters, result.counters);
  return {
    status: results.some((result) => result.status === "FAILED") ? "PARTIAL" : "COMPLETED",
    manifestVersion: manifest.version,
    counters,
    sources: results,
    checkpoint: {
      completedSourceIds: results.filter((result) => result.status === "COMPLETED").map((result) => result.source.id),
      unavailableSourceIds: results.filter((result) => result.status === "NOT_AVAILABLE").map((result) => result.source.id),
      failedSourceIds: results.filter((result) => result.status === "FAILED").map((result) => result.source.id),
    },
  };
}
