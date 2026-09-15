import test from 'node:test';
import assert from 'node:assert/strict';

test('match-context is read-only, strict-prior and sanitizes BigDB rows', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-cfi-key'], 'test-key');
    const input = JSON.parse(init.body);
    assert.deepEqual(input, { home: 'Home FC', away: 'Away FC', target_date: '2026-09-15' });
    return Response.json({
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
    });
  };

  try {
    const worker = (await import('../cloudflare-worker/src/index-gpt-core-v5.ts')).default;
    const request = new Request('https://cfi.local/api/match-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ home:'Home FC', away:'Away FC', target_date:'2026-09-15' })
    });
    const response = await worker.fetch(request, {
      CFI_DB_BASE_URL:'https://example.supabase.co/functions/v1/cfi-db',
      CFI_DB_KEY:'test-key'
    }, {});
    assert.equal(response.status, 200);
    const body = await response.json();
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('match-context maps upstream 402 to service unavailable without fabricating data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error:'PAYMENT_REQUIRED' }, { status:402 });
  try {
    const worker = (await import('../cloudflare-worker/src/index-gpt-core-v5.ts?upstream402=1')).default;
    const response = await worker.fetch(new Request('https://cfi.local/api/match-context', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({home:'A',away:'B',target_date:'2026-09-15'})
    }), {
      CFI_DB_BASE_URL:'https://example.supabase.co/functions/v1/cfi-db',
      CFI_DB_KEY:'test-key'
    }, {});
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'BIGDB_CONTEXT_REJECTED');
    assert.equal(body.upstreamStatus, 402);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
