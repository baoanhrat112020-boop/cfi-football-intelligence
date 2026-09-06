import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBigDbIdentityGapAudit,
  classifyIdentityGap,
  identityCohort
} from '../src/discovery/bigdb-identity-gap-audit.mjs';

function receipt(overrides = {}) {
  return {
    requestId: 'r1',
    identityKey: 'home|away|2026-09-05',
    lane: 'CROSSCHECK_REQUIRED_QUEUE',
    home: 'Home',
    away: 'Away',
    targetDate: '2026-09-05',
    kickoffIso: '2026-09-05T02:00:00.000Z',
    bigDb: {
      status: 'INSUFFICIENT',
      reason: 'NO_EXACT_IDENTITY',
      ready: false,
      identity: {
        homeTeamId: null,
        awayTeamId: null,
        homeCanonical: null,
        awayCanonical: null,
        homeResolution: 'NO_EXACT_IDENTITY_KEY',
        awayResolution: 'NO_EXACT_IDENTITY_KEY'
      }
    },
    ...overrides
  };
}

test('identity gap distinguishes both-side and one-side misses', () => {
  assert.equal(classifyIdentityGap(receipt()), 'BOTH_IDENTITIES_MISSING');
  assert.equal(classifyIdentityGap(receipt({
    bigDb: {
      status: 'INSUFFICIENT', reason: 'NO_EXACT_IDENTITY', ready: false,
      identity: { homeTeamId: 'H1', awayTeamId: null }
    }
  })), 'AWAY_IDENTITY_MISSING');
  assert.equal(classifyIdentityGap(receipt({
    bigDb: {
      status: 'INSUFFICIENT', reason: 'NO_EXACT_IDENTITY', ready: false,
      identity: { homeTeamId: null, awayTeamId: 'A1' }
    }
  })), 'HOME_IDENTITY_MISSING');
});

test('cohort audit recognizes women and youth markers without using them as auto aliases', () => {
  assert.equal(identityCohort('Atlas W'), 'WOMEN');
  assert.equal(identityCohort('Chivas Guadalajara Women'), 'WOMEN');
  assert.equal(identityCohort('New Zealand U19'), 'U19');
  assert.equal(identityCohort('Club America'), 'SENIOR');
});

test('audit remains read-only and flags canonical cohort mismatch fail-closed', () => {
  const audit = buildBigDbIdentityGapAudit({ rows: [receipt({
    home: 'Atlas W',
    away: 'Guadalajara Chivas W',
    bigDb: {
      status: 'INSUFFICIENT',
      reason: 'NO_EXACT_IDENTITY',
      ready: false,
      identity: {
        homeTeamId: 'H1',
        awayTeamId: null,
        homeCanonical: 'Atlas',
        awayCanonical: null,
        homeResolution: 'CANONICAL_EXACT',
        awayResolution: 'NO_EXACT_IDENTITY_KEY'
      }
    }
  })] }, { generatedAt: '2026-09-05T00:00:00.000Z', sourceCycleId: 'cycle-1' });

  assert.equal(audit.status, 'PASS_WITH_COHORT_REVIEW');
  assert.equal(audit.metrics.cohortReviewRequired, 1);
  assert.equal(audit.rows[0].gapClass, 'AWAY_IDENTITY_MISSING');
  assert.equal(audit.rows[0].cohortGuard.status, 'FAIL_CLOSED_REVIEW');
  assert.equal(audit.rows[0].autoAliasAllowed, false);
  assert.equal(audit.rows[0].canonicalTeamCreateAllowed, false);
  assert.equal(audit.policy.rawFixtureUpsertForIdentityRescueAllowed, false);
  assert.equal(audit.policy.bigDbWriteAllowed, false);
});
