import fs from 'node:fs/promises';
import { R0_DATASET_CONTRACT } from './run-r0-bulk.mjs';
import { createResearchSupabaseReader, resolveResearchCredentials } from './supabase-read-adapter.mjs';

export async function exportR0Corpus({ baseUrl, serviceRoleKey, key, fetchImpl = fetch } = {}) {
  const reader = createResearchSupabaseReader({
    baseUrl,
    serviceRoleKey: serviceRoleKey ?? key,
    fetchImpl,
  });

  const teams = await reader.readAll(
    'teams?select=team_id,canonical_name&order=team_id.asc',
    { critical: true, label: 'teams' },
  );
  const teamNames = new Map(teams.map(t => [t.team_id, t.canonical_name]));

  const filter = [
    'select=fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,status,competition_key,competition_name,country,season,competition_segment',
    `match_date=gte.${R0_DATASET_CONTRACT.warmupStart}`,
    `match_date=lt.${R0_DATASET_CONTRACT.prospectiveHoldoutStart}`,
    'order=match_date.asc,fixture_id.asc',
  ].join('&');
  const fixtures = await reader.readAll(
    `fixtures?${filter}`,
    { critical: true, label: 'fixtures' },
  );

  const rows = fixtures.map(f => ({
    fixture_id: f.fixture_id,
    match_date: f.match_date,
    home_team_id: f.home_team_id,
    away_team_id: f.away_team_id,
    home_team: teamNames.get(f.home_team_id) ?? null,
    away_team: teamNames.get(f.away_team_id) ?? null,
    ht_home: f.ht_home,
    ht_away: f.ht_away,
    ft_home: f.ft_home,
    ft_away: f.ft_away,
    status: f.status,
    competition_key: f.competition_key ?? null,
    competition_name: f.competition_name ?? null,
    country: f.country ?? null,
    season: f.season ?? null,
    competition_segment: f.competition_segment ?? null,
  })).filter(f => f.home_team && f.away_team);

  if (rows.length === 0) {
    throw new Error('CFI_RESEARCH_EMPTY_CANONICAL_CORPUS');
  }
  if (rows.some(r => r.match_date >= R0_DATASET_CONTRACT.prospectiveHoldoutStart)) {
    throw new Error('R0_HOLDOUT_LEAKAGE');
  }

  const metadataCoverage = {
    competition: rows.filter(r => r.competition_key).length,
    season: rows.filter(r => r.season).length,
    segment: rows.filter(r => r.competition_segment).length,
  };

  return {
    manifestVersion: R0_DATASET_CONTRACT.manifestVersion,
    exportedAt: new Date().toISOString(),
    fixtureCount: rows.length,
    sourceFixtureCount: fixtures.length,
    droppedUnresolvedTeamCount: fixtures.length - rows.length,
    privilegedResearchRead: true,
    metadataCoverage,
    fixtures: rows,
  };
}

async function main() {
  const { baseUrl, key } = resolveResearchCredentials(process.env);
  const output = process.argv[2] ?? 'r0-corpus.json';
  const corpus = await exportR0Corpus({ baseUrl, serviceRoleKey: key });
  await fs.writeFile(output, JSON.stringify(corpus) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    fixtureCount: corpus.fixtureCount,
    manifestVersion: corpus.manifestVersion,
    privilegedResearchRead: corpus.privilegedResearchRead,
    metadataCoverage: corpus.metadataCoverage,
  }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err?.stack ?? String(err));
    process.exitCode = 1;
  });
}
