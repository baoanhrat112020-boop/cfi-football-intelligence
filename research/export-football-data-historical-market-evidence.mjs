import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HISTORICAL_SOURCES } from '../local-node/harvester/football-data/historical-registry.mjs';
import {
  FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1,
  parseFootballDataHistoricalMarketEvidence,
} from '../local-node/harvester/football-data/historical-market-evidence.mjs';

export const GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1 = Object.freeze({
  version: 'CFI_GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
  reconstructed: false,
  capturedAtFabricated: false,
  evaluationStart: '2016-01-01',
  evaluationEnd: '2026-08-19',
  defaultSourceIds: Object.freeze([
    'football-data-2425-E0',
    'football-data-2425-E1',
    'football-data-2425-E2',
    'football-data-2425-E3',
    'football-data-2425-D1',
    'football-data-2425-I1',
    'football-data-2425-SP1',
    'football-data-2425-F1',
    'football-data-2526-E0',
    'football-data-2526-E1',
    'football-data-2526-E2',
    'football-data-2526-E3',
    'football-data-2526-D1',
    'football-data-2526-I1',
    'football-data-2526-SP1',
    'football-data-2526-F1',
  ]),
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function configuredSourceIds(env = process.env) {
  const raw = String(env.CFI_FOOTBALL_DATA_MARKET_SOURCE_IDS ?? '').trim();
  return raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [...GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1.defaultSourceIds];
}

async function fetchCsv(source, fetchImpl, retries = 2) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(source.url, {
        headers: {
          'user-agent': 'CFI-Research-Market-Evidence/1.0',
          accept: 'text/csv,text/plain,*/*',
          'cache-control': 'no-cache',
        },
        redirect: 'follow',
      });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
        if (/^\s*</.test(text) || !text.includes('HomeTeam') || !text.includes('AwayTeam')) throw new Error('INVALID_CSV_PAYLOAD');
        return { bytes, text, httpStatus: response.status };
      }
      last = new Error(`HTTP_${response.status}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      last = error;
    }
    if (attempt < retries) await sleep(500 * (attempt + 1));
  }
  throw last ?? new Error('FOOTBALL_DATA_FETCH_FAILED');
}

function openingMarketCount(rows) {
  return rows.reduce((n, row) => n + Number(Boolean(
    row?.opening?.oneXTwo?.bookmaker || row?.opening?.oneXTwo?.marketAverage ||
    row?.opening?.overUnder25?.bookmaker || row?.opening?.overUnder25?.marketAverage ||
    row?.opening?.asianHandicap?.bookmaker || row?.opening?.asianHandicap?.marketAverage
  )), 0);
}

export async function exportFootballDataHistoricalMarketEvidence({
  fetchImpl = fetch,
  sourceIds = configuredSourceIds(),
  outputPath = null,
  pauseMs = 250,
} = {}) {
  const sourceMap = new Map(HISTORICAL_SOURCES.map(source => [source.id, source]));
  const selected = sourceIds.map(id => sourceMap.get(id)).filter(Boolean);
  if (selected.length !== sourceIds.length) {
    const missing = sourceIds.filter(id => !sourceMap.has(id));
    throw new Error(`FOOTBALL_DATA_MARKET_UNKNOWN_SOURCE_IDS:${missing.join(',')}`);
  }
  if (!selected.length) throw new Error('FOOTBALL_DATA_MARKET_SOURCE_SET_EMPTY');

  const rows = [];
  const sourceResults = [];
  for (let i = 0; i < selected.length; i += 1) {
    const source = selected[i];
    try {
      const fetched = await fetchCsv(source, fetchImpl);
      const sha256 = createHash('sha256').update(fetched.bytes).digest('hex');
      const parsed = parseFootballDataHistoricalMarketEvidence(source, fetched.text, { sourceSha256: sha256 });
      const eligible = parsed.rows.filter(row =>
        row.date >= GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1.evaluationStart &&
        row.date <= GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1.evaluationEnd &&
        row.temporalProvenance?.opening?.strictPriorSemantic === true &&
        row.temporalProvenance?.opening?.capturedAt === null &&
        row.providerPolicy?.pinnacleUsed === false
      );
      rows.push(...eligible);
      sourceResults.push({
        sourceId: source.id,
        sourceUrl: source.url,
        status: 'PASS',
        httpStatus: fetched.httpStatus,
        sha256,
        parsedRows: parsed.rows.length,
        eligibleRows: eligible.length,
      });
    } catch (error) {
      sourceResults.push({
        sourceId: source.id,
        sourceUrl: source.url,
        status: 'FAIL',
        error: String(error?.message ?? error),
      });
    }
    if (i < selected.length - 1 && pauseMs > 0) await sleep(pauseMs);
  }

  const uniqueRows = [...new Map(rows.map(row => [row.identity_key, row])).values()];
  const hardBlockers = [];
  if (!uniqueRows.length) hardBlockers.push('NO_HISTORICAL_MARKET_EVIDENCE');
  if (sourceResults.every(row => row.status !== 'PASS')) hardBlockers.push('ALL_HISTORICAL_MARKET_SOURCES_FAILED');
  if (uniqueRows.some(row => !/^[a-f0-9]{64}$/.test(String(row.source_sha256 ?? '')))) hardBlockers.push('SOURCE_SHA256_REQUIRED');
  if (uniqueRows.some(row => row.reconstructed !== false || row.temporalProvenance?.opening?.strictPriorSemantic !== true || row.temporalProvenance?.opening?.capturedAt !== null)) hardBlockers.push('HISTORICAL_MARKET_TEMPORAL_PROVENANCE_INVALID');
  if (uniqueRows.some(row => row.providerPolicy?.pinnacleUsed !== false)) hardBlockers.push('PINNACLE_POST_CUTOFF_POLICY_VIOLATION');

  const result = {
    ...GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1,
    evidenceContract: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.version,
    generatedAt: new Date().toISOString(),
    status: hardBlockers.length ? 'BLOCKED' : 'READY',
    hardBlockers,
    sourceSemanticsUrl: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.sourceSemanticsUrl,
    sourceResults,
    coverage: {
      sourcesRequested: sourceIds.length,
      sourcesSuccessful: sourceResults.filter(row => row.status === 'PASS').length,
      evidenceRows: uniqueRows.length,
      openingMarketRows: openingMarketCount(uniqueRows),
    },
    rows: uniqueRows,
  };

  if (result.productionMutationAllowed !== false || result.canonicalWriteAllowed !== false || result.decisionUse !== false || result.reconstructed !== false || result.capturedAtFabricated !== false) {
    throw new Error('FOOTBALL_DATA_MARKET_EXPORT_ISOLATION_FAIL');
  }
  if (outputPath) await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`);
  return result;
}

async function main() {
  const outputPath = process.argv[2] ?? 'football-data-historical-market-evidence.json';
  const result = await exportFootballDataHistoricalMarketEvidence({ outputPath });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    version: result.version,
    status: result.status,
    hardBlockers: result.hardBlockers,
    coverage: result.coverage,
    researchOnly: result.researchOnly,
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
  })}\n`);
  if (result.status !== 'READY') process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
