import test from 'node:test';
import assert from 'node:assert/strict';
import { exportForwardMarketCanonicalLinkAudit } from '../research/export-forward-market-canonical-links.mjs';

function fakeReader() {
  return {
    async readAll(path) {
      if (path.startsWith('cfi_forward_market_captures?')) {
        return [
          {
            capture_id: 'cap-1',
            external_fixture_key: '2026-08-24|roma|fiorentina',
            home_team: 'AS Roma',
            away_team: 'Fiorentina',
            competition: 'Italy Serie A',
            scheduled_at_raw: '2026-08-24 18:45 UTC',
            kickoff_at: '2026-08-24T18:45:00Z',
            kickoff_verified: true,
            bookmaker: 'Example',
            market_family: '1X2',
            period: 'FT',
            odds_home: 2.2,
            odds_draw: 3.2,
            odds_away: 3.4,
            source_name: 'Example',
            source_url: 'https://example.test/roma',
            source_provenance: { ref: 'test' },
            captured_at: '2026-08-24T18:00:00Z',
            verification_status: 'VERIFIED_PREMATCH',
            research_only: true,
          },
          {
            capture_id: 'cap-after-kickoff',
            external_fixture_key: '2026-08-24|ignored|ignored',
            home_team: 'Ignored',
            away_team: 'Ignored',
            kickoff_at: '2026-08-24T18:45:00Z',
            captured_at: '2026-08-24T18:46:00Z',
            verification_status: 'VERIFIED_PREMATCH',
            research_only: true,
          },
        ];
      }
      if (path.startsWith('fixtures?')) {
        assert.match(path, /match_date=gte\.2026-08-24/);
        assert.match(path, /match_date=lte\.2026-08-24/);
        return [{
          fixture_id: 'fixture-roma',
          match_date: '2026-08-24',
          home_team_id: 'team-roma',
          away_team_id: 'team-fio',
          competition_key: 'italy:i1',
        }];
      }
      if (path.startsWith('teams?')) {
        return [
          { team_id: 'team-roma', canonical_name: 'Roma' },
          { team_id: 'team-fio', canonical_name: 'Fiorentina' },
        ];
      }
      if (path.startsWith('team_aliases?')) return [];
      throw new Error(`UNEXPECTED_PATH:${path}`);
    },
  };
}

test('forward market audit filters post-kickoff rows, links same-date canonical fixture and stays read-only', async () => {
  const result = await exportForwardMarketCanonicalLinkAudit({ reader: fakeReader() });
  assert.equal(result.version, 'CFI_FORWARD_MARKET_LINK_AUDIT_V1');
  assert.equal(result.researchOnly, true);
  assert.equal(result.decisionUse, false);
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.canonicalWriteAllowed, false);
  assert.equal(result.input.verifiedPrematchRows, 1);
  assert.equal(result.input.verifiedPrematchExternalFixtures, 1);
  assert.deepEqual(result.input.targetDateRange, { minDate: '2026-08-24', maxDate: '2026-08-24' });
  assert.equal(result.linkage.verifiedRows, 1);
  assert.equal(result.linkage.verifiedExternalFixtures, 1);
  assert.equal(result.linkage.verifiedCanonicalFixtures, 1);
  assert.equal(result.rows[0].fixture.fixtureId, 'fixture-roma');
  assert.equal(result.rows[0].targetDateSource, 'EXTERNAL_FIXTURE_KEY');
  assert.equal(result.rows[0].provenance.canonicalWritePerformed, false);
});
