#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CROSSCHECK = resolve(
  process.env.CFI_DATE_CONTEXT_QUEUE_FILE ||
  'local-node/cache/registry/cycle1-crosscheck-required-queue.json'
);
const PROBE_AUDIT = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);
const OUTPUT = resolve(
  process.env.CFI_DATE_CONTEXT_AUDIT_FILE ||
  'local-node/cache/registry/cycle1-browser-date-context-audit.json'
);
const CONTEXT_RADIUS = Math.max(
  2,
  Math.min(12, Number(process.env.CFI_DATE_CONTEXT_RADIUS ?? 5))
);

const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
const fold = value => clean(value)
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function dateTokens(value) {
  const text = clean(value);
  const patterns = [
    /\b20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}\b/g,
    /\b\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}\b/g,
    /\b(?:today|tomorrow|yesterday)\b/gi,
    /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/gi,
    /\b\d{1,2}[\/-]\d{1,2}\b/g
  ];
  const out = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const token = clean(match[0]);
      if (token && !out.includes(token)) out.push(token);
    }
  }
  return out;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

function candidateManifestPath(provider) {
  return resolve(
    'local-node/browser/fixture-collector/input',
    `${clean(provider).toLowerCase()}-candidates.json`
  );
}

function exactCandidate(rows, fixture) {
  const home = fold(fixture?.home);
  const away = fold(fixture?.away);
  const kickoff = clean(fixture?.kickoffIso);
  return (Array.isArray(rows) ? rows : []).find(row =>
    fold(row?.home_team) === home &&
    fold(row?.away_team) === away &&
    clean(row?.kickoff_utc) === kickoff
  ) ?? null;
}

function bestLineMatch(lines, fixture, candidate) {
  const home = fold(candidate?.home_team ?? fixture?.home);
  const away = fold(candidate?.away_team ?? fixture?.away);
  const time = clean(candidate?.parser_evidence?.time_line ?? fixture?.kickoffLocal);
  let best = null;

  for (let index = 0; index < lines.length; index += 1) {
    const current = fold(lines[index]);
    const next = index + 1 < lines.length ? fold(lines[index + 1]) : '';
    const next2 = index + 2 < lines.length ? fold(lines[index + 2]) : '';
    const joined = [current, next, next2].join(' ');
    const hasHome = home && joined.includes(home);
    const hasAway = away && joined.includes(away);
    if (!hasHome || !hasAway) continue;

    let score = 10;
    if (current.includes(home) && current.includes(away)) score += 5;
    if (time && clean(lines[index]).includes(time)) score += 3;
    if (time && index > 0 && clean(lines[index - 1]) === time) score += 3;
    if (!best || score > best.score) best = { index, score };
  }

  return best;
}

function contextFor(lines, index) {
  if (!Number.isInteger(index) || index < 0) return [];
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(lines.length, index + CONTEXT_RADIUS + 3);
  return lines.slice(start, end).map((text, offset) => ({
    line: start + offset + 1,
    text: clean(text),
    dateTokens: dateTokens(text)
  }));
}

function contextClassification(context, targetDate) {
  const tokens = context.flatMap(row => row.dateTokens ?? []);
  if (tokens.includes(targetDate) || tokens.includes(targetDate.replaceAll('-', '/'))) {
    return 'TARGET_DATE_TOKEN_NEARBY';
  }
  if (tokens.some(token => /^20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(token))) {
    return 'OTHER_ABSOLUTE_DATE_TOKEN_NEARBY';
  }
  if (tokens.some(token => /^(today|tomorrow|yesterday)$/i.test(token))) {
    return 'RELATIVE_DATE_TOKEN_NEARBY';
  }
  if (tokens.length > 0) return 'PARTIAL_DATE_TOKEN_NEARBY';
  return 'NO_DATE_TOKEN_NEARBY';
}

const generatedAt = new Date().toISOString();
const queue = await readJson(CROSSCHECK, { rows: [] });
const probe = await readJson(PROBE_AUDIT, { results: [] });
const probeByProvider = new Map(
  (probe?.results ?? []).map(row => [clean(row?.provider).toUpperCase(), row])
);
const manifestCache = new Map();
const snapshotCache = new Map();
const rows = [];

for (const fixture of Array.isArray(queue?.rows) ? queue.rows : []) {
  const providers = Array.isArray(fixture?.trustedLiveProviders) && fixture.trustedLiveProviders.length
    ? fixture.trustedLiveProviders
    : Array.isArray(fixture?.providers)
      ? fixture.providers
      : [];

  if (providers.length === 0) {
    rows.push({
      identityKey: fixture?.identityKey ?? null,
      home: fixture?.home ?? null,
      away: fixture?.away ?? null,
      kickoffIso: fixture?.kickoffIso ?? null,
      provider: null,
      status: 'NO_PROVIDER_PROVENANCE',
      decisionUse: false
    });
    continue;
  }

  for (const provider of providers) {
    const providerKey = clean(provider).toUpperCase();
    if (!manifestCache.has(providerKey)) {
      manifestCache.set(providerKey, await readJson(candidateManifestPath(providerKey), { candidates: [] }));
    }
    const manifest = manifestCache.get(providerKey);
    const candidate = exactCandidate(manifest?.candidates, fixture);
    const probeRow = probeByProvider.get(providerKey) ?? null;
    const snapshotPath = probeRow?.snapshot ? resolve(probeRow.snapshot) : null;

    let snapshotLines = [];
    if (snapshotPath) {
      if (!snapshotCache.has(snapshotPath)) {
        try {
          const text = await readFile(snapshotPath, 'utf8');
          snapshotCache.set(snapshotPath, text.split(/\r?\n/));
        } catch {
          snapshotCache.set(snapshotPath, []);
        }
      }
      snapshotLines = snapshotCache.get(snapshotPath);
    }

    const match = candidate ? bestLineMatch(snapshotLines, fixture, candidate) : null;
    const context = match ? contextFor(snapshotLines, match.index) : [];
    const classification = contextClassification(context, fixture?.targetDate ?? queue?.targetDate ?? null);
    const status = !candidate
      ? 'CANDIDATE_MANIFEST_MATCH_NOT_FOUND'
      : !snapshotPath
        ? 'SNAPSHOT_PATH_NOT_FOUND'
        : snapshotLines.length === 0
          ? 'SNAPSHOT_NOT_READABLE'
          : !match
            ? 'SNAPSHOT_CONTEXT_NOT_FOUND'
            : 'PASS';

    rows.push({
      identityKey: fixture?.identityKey ?? null,
      requestId: fixture?.requestId ?? null,
      home: fixture?.home ?? null,
      away: fixture?.away ?? null,
      targetDate: fixture?.targetDate ?? queue?.targetDate ?? null,
      kickoffIso: fixture?.kickoffIso ?? null,
      kickoffLocal: fixture?.kickoffLocal ?? null,
      provider: providerKey,
      sourceId: candidate?.source_id ?? probeRow?.source_id ?? null,
      sourceUrl: candidate?.source_url ?? probeRow?.requested_url ?? null,
      candidateFound: Boolean(candidate),
      candidateParserEvidence: candidate?.parser_evidence ?? null,
      contextFound: Boolean(match),
      contextClassification: classification,
      dateTokens: [...new Set(context.flatMap(row => row.dateTokens ?? []))],
      context,
      status,
      decisionUse: false,
      bigDbWriteAllowed: false,
      productionMutationAllowed: false
    });
  }
}

const statusCounts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});
const contextClassifications = rows.reduce((acc, row) => {
  const key = row.contextClassification ?? 'NONE';
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
const report = {
  contract: 'CFI_BROWSER_DATE_CONTEXT_AUDIT_V1',
  generatedAt,
  targetDate: queue?.targetDate ?? null,
  queueContract: queue?.contract ?? null,
  fixtures: Array.isArray(queue?.rows) ? queue.rows.length : 0,
  providerContexts: rows.length,
  status: rows.every(row => row.status === 'PASS') ? 'PASS' : 'PASS_WITH_GAPS',
  statusCounts,
  contextClassifications,
  rows,
  policy: {
    rawSnapshotReadOnly: true,
    exactCandidateHomeAwayKickoffJoinRequired: true,
    fuzzyFixtureReassignmentAllowed: false,
    contextCanMutateKickoff: false,
    contextCanMutateIdentity: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    productionMutationAllowed: false
  }
};

await saveJson(OUTPUT, report);
console.log(JSON.stringify({
  contract: report.contract,
  status: report.status,
  targetDate: report.targetDate,
  fixtures: report.fixtures,
  providerContexts: report.providerContexts,
  statusCounts: report.statusCounts,
  contextClassifications: report.contextClassifications,
  rows: rows.map(row => ({
    identityKey: row.identityKey,
    provider: row.provider,
    kickoffIso: row.kickoffIso,
    status: row.status,
    contextClassification: row.contextClassification,
    dateTokens: row.dateTokens,
    parserDateBasis: row.candidateParserEvidence?.date_basis ?? null,
    parserActiveDate: row.candidateParserEvidence?.active_date ?? null,
    parserReferenceDate: row.candidateParserEvidence?.reference_date ?? null
  })),
  decisionUse: false,
  bigDbWriteAllowed: false
}));
