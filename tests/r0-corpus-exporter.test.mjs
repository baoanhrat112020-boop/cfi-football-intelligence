import test from 'node:test';
import assert from 'node:assert/strict';
import { exportR0Corpus } from '../research/export-r0-corpus.mjs';

function jwtForRole(role) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role })}.test-signature`;
}

const SERVICE_ROLE_KEY = jwtForRole('service_role');

function mockFetch(url) {
  const u = new URL(url);
  const offset = Number(u.searchParams.get('offset') ?? 0);
  const isTeams = u.pathname.endsWith('/teams');
  if (isTeams) {
    const rows = offset === 0 ? [
      { team_id: 'h', canonical_name: 'Home FC' },
      { team_id: 'a', canonical_name: 'Away FC' },
    ] : [];
    return Promise.resolve({ ok: true, status: 200, json: async () => rows });
  }
  const rows = offset === 0 ? [
    { fixture_id: 'f1', match_date: '2015-01-02', home_team_id: 'h', away_team_id: 'a', ht_home: 1, ht_away: 0, ft_home: 2, ft_away: 1, status: 'CANONICAL' },
    { fixture_id: 'f2', match_date: '2026-08-19', home_team_id: 'a', away_team_id: 'h', ht_home: 0, ht_away: 0, ft_home: 1, ft_away: 1, status: 'CANONICAL' },
  ] : [];
  return Promise.resolve({ ok: true, status: 200, json: async () => rows });
}

test('exports canonical names through privileged reader and excludes prospective holdout', async () => {
  const out = await exportR0Corpus({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl: mockFetch,
  });
  assert.equal(out.manifestVersion, 'CFI_TIME_MACHINE_V2');
  assert.equal(out.fixtureCount, 2);
  assert.equal(out.sourceFixtureCount, 2);
  assert.equal(out.droppedUnresolvedTeamCount, 0);
  assert.equal(out.privilegedResearchRead, true);
  assert.equal(out.fixtures[0].home_team, 'Home FC');
  assert.ok(out.fixtures.every(r => r.match_date < '2026-08-20'));
});

test('fails closed without URL or privileged research key', async () => {
  await assert.rejects(
    () => exportR0Corpus({ serviceRoleKey: SERVICE_ROLE_KEY, fetchImpl: mockFetch }),
    /CFI_SUPABASE_URL_REQUIRED/,
  );
  await assert.rejects(
    () => exportR0Corpus({ baseUrl: 'https:\/\/example.supabase.co', fetchImpl: mockFetch }),
    /CFI_RESEARCH_PRIVILEGED_KEY_REQUIRED/,
  );
});

test('rejects publishable or anon keys instead of silently reading an RLS-empty corpus', async () => {
  await assert.rejects(
    () => exportR0Corpus({
      baseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'sb_publishable_not_for_research',
      fetchImpl: mockFetch,
    }),
    /PUBLISHABLE_KEY_REJECTED/,
  );
  await assert.rejects(
    () => exportR0Corpus({
      baseUrl: 'https://example.supabase.co',
      serviceRoleKey: jwtForRole('anon'),
      fetchImpl: mockFetch,
    }),
    /NON_SERVICE_ROLE_JWT_REJECTED/,
  );
});

test('fails closed when a critical RLS-backed dataset is unexpectedly empty', async () => {
  const emptyFetch = async () => ({ ok: true, status: 200, json: async () => [] });
  await assert.rejects(
    () => exportR0Corpus({
      baseUrl: 'https://example.supabase.co',
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: emptyFetch,
    }),
    /CFI_RESEARCH_EMPTY_TEAMS/,
  );
});
