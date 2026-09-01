import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoricalMarketBoardGate } from '../research/group-a-historical-market-board-gate.mjs';
import { GROUP_A_CHALLENGERS } from '../research/group-a-full-suite-v1.mjs';

function mm(home = 0.5, draw = 0.25, away = 0.25) {
  return {
    oneXTwo: { ft: { home, draw, away } },
    overUnder: { ft: {} },
    asianHandicap: { ft: {} },
  };
}

function fixture(i) {
  const date = `2025-08-${String((i % 20) + 1).padStart(2, '0')}`;
  return {
    fixture_id: `fixture-${i}`,
    match_date: date,
    home_team: `Home ${i}`,
    away_team: `Away ${i}`,
    ft_home: i % 3 === 0 ? 1 : 2,
    ft_away: i % 3 === 0 ? 1 : 0,
  };
}

function evidenceRow(row, i) {
  return {
    identity_key: `market-${i}`,
    source_sha256: 'a'.repeat(64),
    date: row.match_date,
    home_team: row.home_team,
    away_team: row.away_team,
    actual_ft_home: row.ft_home,
    actual_ft_away: row.ft_away,
    reconstructed: false,
    opening: {
      oneXTwo: {
        bookmaker: { bookmaker: 'Bet365', odds_home: 2.0, odds_draw: 3.5, odds_away: 4.0 },
        marketAverage: { provider: 'avg', odds_home: 2.05, odds_draw: 3.4, odds_away: 3.9 },
      },
      overUnder25: { line: null, bookmaker: null, marketAverage: null },
      asianHandicap: { line: null, bookmaker: null, marketAverage: null },
    },
    closing: {},
    temporalProvenance: {
      opening: { strictPriorSemantic: true, capturedAt: null, decisionEligible: true },
      closing: { decisionEligible: false },
    },
    providerPolicy: { pinnacleUsed: false },
  };
}

function setup(n) {
  const corpus = Array.from({ length: n }, (_, i) => fixture(i));
  const marketEvidence = {
    version: 'CFI_GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1',
    status: 'READY',
    researchOnly: true,
    decisionUse: false,
    productionMutationAllowed: false,
    canonicalWriteAllowed: false,
    reconstructed: false,
    capturedAtFabricated: false,
    coverage: { evidenceRows: n },
    rows: corpus.map(evidenceRow),
  };
  const observations = {
    baseline: new Map(),
    challengers: new Map(GROUP_A_CHALLENGERS.map(name => [name, new Map()])),
  };
  for (const row of corpus) {
    const target = { id: row.fixture_id, matchDate: row.match_date, homeTeam: row.home_team, awayTeam: row.away_team, ft: { home: row.ft_home, away: row.ft_away } };
    observations.baseline.set(row.fixture_id, { kind: 'baseline', target, mm: mm() });
    for (const name of GROUP_A_CHALLENGERS) observations.challengers.get(name).set(row.fixture_id, { kind: 'challenger', name, target, mm: mm() });
  }
  const result = {
    challengers: Object.fromEntries(GROUP_A_CHALLENGERS.map(name => [name, {
      hardBlockers: ['NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'],
      shadowEligible: false,
      promotionDecision: 'HOLD',
      productionEligible: false,
      decisionUse: false,
      productionMutationAllowed: false,
    }])),
  };
  return { corpus, marketEvidence, observations, result };
}

test('historical market board gate clears only the synchronized-odds blocker at 30 paired executable fixtures', () => {
  const x = setup(30);
  const out = applyHistoricalMarketBoardGate(x.result, x.observations, x.marketEvidence, x.corpus);
  assert.equal(out.historicalMarketBoardEvaluation.canonicalLinkage.uniqueCanonicalEvidenceFixtures, 30);
  for (const candidate of Object.values(out.challengers)) {
    assert.equal(candidate.historicalMarketBoard.sampleReady, true);
    assert.equal(candidate.historicalMarketBoard.challenger.pairedExecutableFixtures, 30);
    assert.equal(candidate.historicalMarketBoard.boardRegressions.length, 0);
    assert.equal(candidate.hardBlockers.includes('NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'), false);
    assert.equal(candidate.shadowEligible, false);
    assert.equal(candidate.promotionDecision, 'HOLD');
    assert.equal(candidate.productionEligible, false);
  }
});

test('historical market board gate remains fail-closed below 30 paired executable fixtures', () => {
  const x = setup(29);
  const out = applyHistoricalMarketBoardGate(x.result, x.observations, x.marketEvidence, x.corpus);
  for (const candidate of Object.values(out.challengers)) {
    assert.equal(candidate.historicalMarketBoard.sampleReady, false);
    assert.ok(candidate.hardBlockers.includes('NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'));
  }
});
