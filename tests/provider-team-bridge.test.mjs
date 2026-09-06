import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeProviderTeamName,
  foldProviderTeamName
} from '../supabase/functions/_shared/cfi-provider-team-bridge.ts';

test('live Tier-A women aliases bridge only the explicitly verified entities', () => {
  assert.equal(bridgeProviderTeamName('Atlas W'), 'Atlas Women');
  assert.equal(bridgeProviderTeamName('ATLAS W'), 'Atlas Women');
  assert.equal(
    bridgeProviderTeamName('Guadalajara Chivas W'),
    'Chivas Guadalajara Women'
  );
});

test('provider bridge never generalizes W, youth, or unrelated club identities', () => {
  assert.equal(bridgeProviderTeamName('Bay FC W'), 'Bay FC W');
  assert.equal(bridgeProviderTeamName('Eastern Suburbs W'), 'Eastern Suburbs W');
  assert.equal(bridgeProviderTeamName('New Zealand U19'), 'New Zealand U19');
  assert.equal(bridgeProviderTeamName('Atlas'), 'Atlas');
  assert.notEqual(foldProviderTeamName('Atlas W'), foldProviderTeamName('Atlas Women'));
});
