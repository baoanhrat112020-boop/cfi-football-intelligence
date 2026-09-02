import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bridgeProviderTeamName,
  foldProviderTeamName
} from '../supabase/functions/_shared/cfi-provider-team-bridge.ts';

test('provider bridge performs normalized exact curated mapping only', () => {
  assert.equal(
    bridgeProviderTeamName('Manchester City'),
    'Man City'
  );

  assert.equal(
    bridgeProviderTeamName('  MANCHESTER   CITY  '),
    'Man City'
  );

  assert.equal(
    bridgeProviderTeamName('Bayern München'),
    'Bayern Munich'
  );

  assert.equal(
    bridgeProviderTeamName('Manchester Cty'),
    'Manchester Cty'
  );

  assert.equal(
    bridgeProviderTeamName('Manchester City FC'),
    'Manchester City FC'
  );
});

test('provider bridge preserves entity scope unless explicitly curated', () => {
  for (const value of [
    'Manchester City U21',
    'Manchester City U19',
    'Manchester City Women',
    'Manchester City Reserves',
    'Manchester City Academy'
  ]) {
    assert.equal(bridgeProviderTeamName(value), value);
  }
});

test('provider bridge is idempotent across curated identities', () => {
  const values = [
    'Manchester City',
    'Manchester United',
    'AC Milan',
    'Bayern München',
    'Paris Saint Germain',
    'PSG',
    'Royal Antwerp',
    'Antwerp',
    'Athletico Paranaense',
    'Atletico Paranaense',
    'Athletico-PR',
    'Flora Tallinn',
    'Leeds United',
    'Leeds United AFC'
  ];

  for (const input of values) {
    const once = bridgeProviderTeamName(input);
    const twice = bridgeProviderTeamName(once);

    assert.equal(
      twice,
      once,
      `${input} drifted: ${input} -> ${once} -> ${twice}`
    );
  }
});

test('provider folding is normalization only, not fuzzy matching', () => {
  assert.equal(
    foldProviderTeamName('Paris Saint-Germain'),
    'paris saint germain'
  );

  assert.notEqual(
    foldProviderTeamName('Manchester City'),
    foldProviderTeamName('Manchester Cty')
  );
});