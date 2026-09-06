import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistryCoverageMatrix } from '../src/discovery/registry-source-adapters.mjs';

test('Tier A browser fixtures are additive and rescue fixtures without PC Node', () => {
  const registry = {
    entries: [
      { sourceClasses: ['PC_NODE'] },
      { sourceClasses: ['TIER_A_BROWSER_DISCOVERY'] },
      { sourceClasses: ['TIER_A_BROWSER_DISCOVERY', 'PUBLIC_DISCOVERY'] }
    ]
  };

  const matrix = buildRegistryCoverageMatrix(registry);

  assert.equal(matrix.unionFixtures, 3);
  assert.equal(matrix.pcNodeFixtures, 1);
  assert.equal(matrix.tierABrowserFixtures, 2);
  assert.equal(matrix.rescuedWithoutPcNode, 2);
  assert.equal(matrix.rescuedByTierABrowser, 2);
  assert.equal(matrix.rescuedByPublicDiscovery, 1);
});
