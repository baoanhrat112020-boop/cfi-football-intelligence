import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResearchKey,
  createResearchSupabaseReader,
  resolveResearchCredentials,
} from '../research/supabase-read-adapter.mjs';

function jwtForRole(role) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role })}.test-signature`;
}

test('classifies only backend privileged key forms', () => {
  assert.equal(classifyResearchKey(jwtForRole('service_role')).kind, 'legacy_service_role_jwt');
  assert.equal(classifyResearchKey('sb_secret_server_only').kind, 'secret');
  assert.throws(() => classifyResearchKey('sb_publishable_public'), /PUBLISHABLE_KEY_REJECTED/);
  assert.throws(() => classifyResearchKey(jwtForRole('anon')), /NON_SERVICE_ROLE_JWT_REJECTED/);
  assert.throws(() => classifyResearchKey('opaque-key'), /UNRECOGNIZED_KEY_TYPE/);
});

test('credential resolution prefers explicit research service-role secret and rejects public fallback', () => {
  const serviceRole = jwtForRole('service_role');
  const resolved = resolveResearchCredentials({
    CFI_SUPABASE_URL: 'https://example.supabase.co',
    CFI_SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    CFI_SUPABASE_KEY: 'sb_publishable_should_not_win',
  });
  assert.equal(resolved.baseUrl, 'https://example.supabase.co');
  assert.equal(resolved.key, serviceRole);

  assert.throws(() => resolveResearchCredentials({
    CFI_SUPABASE_URL: 'https://example.supabase.co',
    CFI_SUPABASE_KEY: 'sb_publishable_public',
  }), /PUBLISHABLE_KEY_REJECTED/);
});

test('legacy service-role JWT uses bearer auth while modern secret key does not masquerade as JWT', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return { ok: true, status: 200, json: async () => [{ id: 1 }] };
  };

  const legacy = jwtForRole('service_role');
  const legacyReader = createResearchSupabaseReader({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: legacy,
    fetchImpl,
  });
  await legacyReader.readAll('fixtures?select=fixture_id');
  assert.equal(calls[0].headers.apikey, legacy);
  assert.equal(calls[0].headers.Authorization, `Bearer ${legacy}`);

  const secret = 'sb_secret_server_only';
  const secretReader = createResearchSupabaseReader({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: secret,
    fetchImpl,
  });
  await secretReader.readAll('fixtures?select=fixture_id');
  assert.equal(calls[1].headers.apikey, secret);
  assert.equal('Authorization' in calls[1].headers, false);
});

test('read failures are sanitized and never include the privileged key', async () => {
  const secret = 'sb_secret_DO_NOT_LOG_THIS_VALUE';
  const reader = createResearchSupabaseReader({
    baseUrl: 'https://example.supabase.co',
    serviceRoleKey: secret,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: secret }) }),
  });

  await assert.rejects(async () => {
    try {
      await reader.readAll('fixtures?select=fixture_id');
    } catch (error) {
      assert.equal(String(error).includes(secret), false);
      throw error;
    }
  }, /CFI_RESEARCH_SUPABASE_READ_FAILED:403/);
});
