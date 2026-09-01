import test from 'node:test';
import assert from 'node:assert/strict';
import { exportGroupAFeatures, GROUP_A_FEATURE_BUNDLE_VERSION } from '../research/export-group-a-features.mjs';

function jwtForRole(role) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role })}.test-signature`;
}
const SERVICE_ROLE_KEY = jwtForRole('service_role');

function baseFetch(rowsOverride) {
  return async url => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    if (offset > 0) return { ok: true, status: 200, json: async () => [] };
    if (u.pathname.endsWith('/teams')) {
      return { ok: true, status: 200, json: async () => [
        { team_id: 'h', canonical_name: 'Home FC' },
        { team_id: 'a', canonical_name: 'Away FC' },
      ] };
    }
    if (u.pathname.endsWith('/cfi_team_strength_feature_store_v1')) {
      const rows = rowsOverride ?? [
        { team_id: 'h', as_of_date: '2026-08-18', prior_matches: 30, recent20_matches: 20, attack_index: 1.1, defense_index: .9, net_strength: .2, competition_key: 'england:e1', segment_v2: 'S2', confidence: .8, strict_prior: true, feature_version: 'V1' },
        { team_id: 'a', as_of_date: '2026-08-18', prior_matches: 25, recent20_matches: 20, attack_index: .9, defense_index: 1.1, net_strength: -.2, competition_key: 'england:e1', segment_v2: 'S2', confidence: .7, strict_prior: true, feature_version: 'V1' },
      ];
      return { ok: true, status: 200, json: async () => rows };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
}

test('exports only canonical strict-prior Group A strength rows', async () => {
  const out = await exportGroupAFeatures({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl: baseFetch(),
  });
  assert.equal(out.version, GROUP_A_FEATURE_BUNDLE_VERSION);
  assert.equal(out.strictPrior, true);
  assert.equal(out.strengthRowCount, 2);
  assert.equal(out.competitionCount, 1);
  assert.equal(out.segmentCount, 1);
  assert.equal(out.strengths[0].team_name, 'Home FC');
  assert.equal(out.decisionUse, false);
  assert.equal(out.productionMutationAllowed, false);
});

test('fails closed if a returned feature row is not strict-prior', async () => {
  await assert.rejects(() => exportGroupAFeatures({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl: baseFetch([{ team_id: 'h', as_of_date: '2026-08-18', strict_prior: false }]),
  }), /GROUP_A_NON_STRICT_PRIOR_STRENGTH_ROW/);
});

test('fails closed if a returned strength row enters prospective holdout', async () => {
  await assert.rejects(() => exportGroupAFeatures({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl: baseFetch([{ team_id: 'h', as_of_date: '2026-08-20', strict_prior: true }]),
  }), /GROUP_A_STRENGTH_HOLDOUT_LEAKAGE/);
});
