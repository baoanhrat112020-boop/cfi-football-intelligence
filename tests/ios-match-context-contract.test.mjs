import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchContextPayload,
  bigDbContextHttpStatus,
  normalizeMatchContextFixture,
  localDateInTimeZone,
  strictPriorRetrievalCutoff,
  verifyMatchContextTemporalAudit
} from '../src/runtime/match-context.ts';

test('match-context payload is read-only, strict-prior and sanitizes BigDB rows', () => {
  const big = {
    status: 'OK',
    identity: {
      homeCanonical: 'Home FC',
      awayCanonical: 'Away FC',
      homeTeamId: 'h1',
      awayTeamId: 'a1'
    },
    temporalAudit: {
      verified: true,
      targetDate: '2026-09-15',
      maxEvidenceDate: '2026-09-10',
      futureEvidenceCount: 0,
      sameDateEvidenceCount: 0
    },
    exactTeam: {
      home: { retrieved: 2 },
      away: { retrieved: 2 },
      h2h: { retrieved: 1 }
    },
    fixtures: {
      home: [
        { fixture_id:'1', match_date:'2026-09-10', home_name:'Home FC', away_name:'Rival A', ht_home:1, ht_away:0, ft_home:2, ft_away:0, competition_name:'L1' },
        { fixture_id:'2', match_date:'2026-09-05', home_name:'Rival B', away_name:'Home FC', ht_home:0, ht_away:1, ft_home:1, ft_away:1, competition_name:'L1' }
      ],
      away: [
        { fixture_id:'3', match_date:'2026-09-09', home_name:'Away FC', away_name:'Rival C', ht_home:0, ht_away:0, ft_home:0, ft_away:1, competition_name:'L2' },
        { fixture_id:'4', match_date:'2026-09-03', home_name:'Rival D', away_name:'Away FC', ht_home:1, ht_away:1, ft_home:2, ft_away:3, competition_name:'L2' }
      ],
      h2h: [
        { fixture_id:'5', match_date:'2026-08-01', home_name:'Home FC', away_name:'Away FC', ht_home:0, ht_away:0, ft_home:1, ft_away:0, competition_name:'Cup', provenance:[{secret:'must not leak'}] }
      ]
    }
  };

  const body = buildMatchContextPayload(big, 'Home FC', 'Away FC', '2026-09-15');
  assert.equal(body.status, 'OK');
  assert.equal(body.readOnly, true);
  assert.equal(body.strictPrior, true);
  assert.equal(body.temporalAudit.verified, true);
  assert.deepEqual(body.home.form, ['W','D']);
  assert.deepEqual(body.away.form, ['L','W']);
  assert.equal(body.home.avgGoalsFor, 1.5);
  assert.equal(body.away.avgGoalsFor, 1.5);
  assert.equal(body.h2h.fixtures, 1);
  assert.equal(body.h2h.recent[0].matchDate, '2026-08-01');
  assert.equal('provenance' in body.h2h.recent[0], false);
});

test('context fixture normalization excludes raw provenance and preserves scores', () => {
  const row = normalizeMatchContextFixture({
    fixture_id:'x',
    match_date:'2026-08-01',
    home_name:'A',
    away_name:'B',
    ht_home:1,
    ht_away:0,
    ft_home:3,
    ft_away:2,
    provenance:[{secret:'no'}]
  });
  assert.deepEqual(row?.ht, {home:1,away:0});
  assert.deepEqual(row?.ft, {home:3,away:2});
  assert.equal(row && 'provenance' in row, false);
});

test('upstream 402 maps to service unavailable for match-context', () => {
  assert.equal(bigDbContextHttpStatus(402), 503);
  assert.equal(bigDbContextHttpStatus(500), 502);
});


test('future match context cutoff never advances beyond current local date', () => {
  const now=Date.parse('2026-09-15T06:00:00Z'); // 13:00 Asia/Ho_Chi_Minh
  assert.equal(localDateInTimeZone(now,'Asia/Ho_Chi_Minh'),'2026-09-15');
  assert.equal(strictPriorRetrievalCutoff('2026-09-20',now,'Asia/Ho_Chi_Minh'),'2026-09-15');
  assert.equal(strictPriorRetrievalCutoff('2026-09-10',now,'Asia/Ho_Chi_Minh'),'2026-09-10');
});

test('match context temporal audit fails closed on leakage', () => {
  const ok=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-14',futureEvidenceCount:0,sameDateEvidenceCount:0},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(ok.verified,true);

  const future=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-16',futureEvidenceCount:0,sameDateEvidenceCount:0},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(future.verified,false);

  const sameDateLeak=verifyMatchContextTemporalAudit(
    {verified:true,maxEvidenceDate:'2026-09-14',futureEvidenceCount:0,sameDateEvidenceCount:1},
    '2026-09-20',
    '2026-09-15'
  );
  assert.equal(sameDateLeak.verified,false);
});
