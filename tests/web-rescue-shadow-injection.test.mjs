import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWebRescueShadowInjection } from '../tools/cfi-web-rescue-shadow-injection.mjs';

function tomorrowUtcDate() {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

test('shadow injection executes actual web-search-rescue runtime without widening provider trust', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfi-web-rescue-shadow-test-'));
  try {
    const targetDate = tomorrowUtcDate();
    const input = join(dir, 'candidates.json');
    const reportFile = join(dir, 'report.json');
    const discoveredAt = new Date().toISOString();

    await writeFile(input, JSON.stringify({
      candidates: [
        {
          provider: 'KWFF',
          home: 'Synthetic Suwon Women',
          away: 'Synthetic Incheon Women',
          competition: 'Synthetic WK League',
          country: 'South Korea',
          kickoffIso: `${targetDate}T12:00:00.000Z`,
          targetDate,
          status: 'scheduled',
          sourceUrls: [
            'https://www.kwff.or.kr/wk-league/matches?lang=en',
            'https://www.kwff.or.kr/matches/999001'
          ],
          discoveredAt
        },
        {
          provider: 'SOFASCORE',
          home: 'Synthetic A',
          away: 'Synthetic B',
          competition: 'Synthetic League',
          kickoffIso: `${targetDate}T13:00:00.000Z`,
          targetDate,
          status: 'scheduled',
          sourceUrls: [
            'https://www.sofascore.com/football/match/synthetic-a-synthetic-b/ABC123'
          ],
          discoveredAt
        }
      ]
    }, null, 2));

    const report = await runWebRescueShadowInjection({
      inputFile: input,
      targetDate,
      timeZone: 'UTC',
      reportFile
    });

    assert.equal(report.contract, 'CFI_WEB_RESCUE_SHADOW_INJECTION_V1');
    assert.equal(report.status, 'PASS');
    assert.equal(report.runner.actualRuntimePathExecuted, true);
    assert.equal(report.runner.implementation, 'local-node/registry/web-search-rescue.mjs');
    assert.equal(report.input.candidates, 2);
    assert.equal(report.runtime.accepted, 1);
    assert.equal(report.runtime.rejected, 1);
    assert.equal(report.runtime.aliasReviewRequired, 0);
    assert.equal(report.runtime.providerIdDerivations.length, 1);
    assert.equal(report.runtime.providerIdDerivations[0].providerId, 'KWFF:999001');
    assert.equal(report.runtime.providerIdDerivations[0].rule, 'KWFF_MATCH_CENTER_NUMERIC_ID');
    assert.equal(report.runtime.rows.length, 1);
    assert.equal(report.runtime.rows[0].providerId, 'KWFF:999001');
    assert.equal(report.runtime.rows[0].sourceClass, 'WEB_SEARCH_RESCUE');

    // KWFF event provenance is accepted for provider-ID integrity, but this patch
    // deliberately does not promote KWFF into Tier A/B source-health semantics.
    assert.equal(report.runtime.rows[0].sourceKey, 'UNKNOWN');
    assert.equal(report.runtime.rows[0].sourceTier, 'X');

    assert.equal(report.isolation.registryInvoked, false);
    assert.equal(report.isolation.orchestratorInvoked, false);
    assert.equal(report.isolation.predictionExecutionAllowed, false);
    assert.equal(report.isolation.bigDbNetworkInvoked, false);
    assert.equal(report.isolation.bigDbWriteAllowed, false);
    assert.equal(report.isolation.productionMutationAllowed, false);
    assert.equal(report.isolation.autoAliasAllowed, false);
    assert.equal(report.isolation.canonicalTeamCreateAllowed, false);
    assert.equal(report.policy.providerIdRequired, true);
    assert.equal(report.policy.syntheticProviderIdAllowed, false);
    assert.equal(report.policy.firstPartyWhitelistedEventUrlOnly, true);
    assert.equal(report.policy.sourceTrustPromotionPerformed, false);
    assert.equal(report.policy.runtimeFixtureDataCommitted, false);
    assert.equal(report.policy.decisionUse, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
