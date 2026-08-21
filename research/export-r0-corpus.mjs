import fs from 'node:fs/promises';
import { R0_DATASET_CONTRACT } from './run-r0-bulk.mjs';

const PAGE_SIZE = 1000;

function requiredEnv(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function fetchPage(baseUrl, key, path, offset, fetchImpl = fetch) {
  const url = new URL(`/rest/v1/${path}`, baseUrl);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  const response = await fetchImpl(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`SUPABASE_READ_FAILED:${response.status}:${path}`);
  return response.json();
}

async function fetchAll(baseUrl, key, path, fetchImpl = fetch) {
  const out = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const page = await fetchPage(baseUrl, key, path, offset, fetchImpl);
    if (!Array.isArray(page)) throw new Error('SUPABASE_RESPONSE_NOT_ARRAY');
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

export async function exportR0Corpus({ baseUrl, key, fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new Error('CFI_SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('CFI_SUPABASE_KEY_REQUIRED');

  const teams = await fetchAll(baseUrl, key, 'teams?select=team_id,canonical_name&order=team_id.asc', fetchImpl);
  const teamNames = new Map(teams.map(t => [t.team_id, t.canonical_name]));
  const filter = [
    'select=fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,status',
    `match_date=gte.${R0_DATASET_CONTRACT.warmupStart}`,
    `match_date=lt.${R0_DATASET_CONTRACT.prospectiveHoldoutStart}`,
    'order=match_date.asc,fixture_id.asc',
  ].join('&');
  const fixtures = await fetchAll(baseUrl, key, `fixtures?${filter}`, fetchImpl);

  const rows = fixtures.map(f => ({
    fixture_id: f.fixture_id,
    match_date: f.match_date,
    home_team: teamNames.get(f.home_team_id) ?? null,
    away_team: teamNames.get(f.away_team_id) ?? null,
    ht_home: f.ht_home,
    ht_away: f.ht_away,
    ft_home: f.ft_home,
    ft_away: f.ft_away,
    status: f.status,
  })).filter(f => f.home_team && f.away_team);

  if (rows.some(r => r.match_date >= R0_DATASET_CONTRACT.prospectiveHoldoutStart)) {
    throw new Error('R0_HOLDOUT_LEAKAGE');
  }

  return {
    manifestVersion: R0_DATASET_CONTRACT.manifestVersion,
    exportedAt: new Date().toISOString(),
    fixtureCount: rows.length,
    fixtures: rows,
  };
}

async function main() {
  const baseUrl = requiredEnv('CFI_SUPABASE_URL');
  const key = requiredEnv('CFI_SUPABASE_KEY');
  const output = process.argv[2] ?? 'r0-corpus.json';
  const corpus = await exportR0Corpus({ baseUrl, key });
  await fs.writeFile(output, JSON.stringify(corpus) + '\n');
  process.stdout.write(JSON.stringify({ output, fixtureCount: corpus.fixtureCount, manifestVersion: corpus.manifestVersion }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err?.stack ?? String(err));
    process.exitCode = 1;
  });
}
